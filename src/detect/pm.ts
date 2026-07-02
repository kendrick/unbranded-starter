import type { TargetMode } from './target';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { isCancel, select } from '@clack/prompts';
import { cancelAndExit } from '../util/cancel';

export type Pm = 'npm' | 'pnpm' | 'yarn' | 'bun';

export type PmSource = 'lockfile' | 'packageManager' | 'userAgent';

export type PmInspection
	= | { kind: 'detected'; pm: Pm; source: PmSource; lockfilePath?: string; packageManagerField?: string }
		| { kind: 'needs-prompt' }
		| { kind: 'no-pkg' }
		| { kind: 'workspace-leaf'; workspaceRoot: string };

// Walk-up generator. Workspace markers can live several levels above cwd
// (e.g. `packages/app/src` → workspace root four dirs up).
function* walkUp(start: string): Generator<string> {
	let cur = resolve(start);
	while (true) {
		yield cur;
		const parent = dirname(cur);
		if (parent === cur)
			break;
		cur = parent;
	}
}

function lockfileSignal(dir: string): { pm: Pm; file: string } | null {
	// Order matters: pnpm-lock.yaml beats package-lock.json because the
	// presence of a pnpm lockfile is a strong intent signal, even if npm
	// happens to be the ambient PM via user-agent.
	if (existsSync(join(dir, 'pnpm-lock.yaml')))
		return { pm: 'pnpm', file: 'pnpm-lock.yaml' };
	if (existsSync(join(dir, 'bun.lock')))
		return { pm: 'bun', file: 'bun.lock' };
	if (existsSync(join(dir, 'bun.lockb')))
		return { pm: 'bun', file: 'bun.lockb' };
	if (existsSync(join(dir, 'yarn.lock')))
		return { pm: 'yarn', file: 'yarn.lock' };
	if (existsSync(join(dir, 'package-lock.json')))
		return { pm: 'npm', file: 'package-lock.json' };
	return null;
}

function readPackageJson(dir: string): { packageManager?: unknown } | null {
	const path = join(dir, 'package.json');
	if (!existsSync(path))
		return null;
	try {
		return JSON.parse(readFileSync(path, 'utf-8')) as { packageManager?: unknown };
	}
	catch (err) {
		// Fail loudly here rather than silently classifying as "no signal".
		// Going down the prompt path would lead to a confusing merge-time error
		// later; better to surface the real problem now.
		throw new Error(`Malformed package.json at ${path}: ${(err as Error).message}`);
	}
}

function parsePackageManagerField(pkg: { packageManager?: unknown }): { pm: Pm; field: string } | null {
	const field = pkg.packageManager;
	if (typeof field !== 'string')
		return null;
	const match = /^(pnpm|yarn|npm|bun)@/.exec(field);
	if (!match || !match[1])
		return null;
	return { pm: match[1] as Pm, field };
}

function userAgentSignal(env: NodeJS.ProcessEnv): Pm | null {
	const ua = env.npm_config_user_agent;
	if (!ua)
		return null;
	if (ua.startsWith('pnpm/'))
		return 'pnpm';
	if (ua.startsWith('bun/'))
		return 'bun';
	if (ua.startsWith('yarn/'))
		return 'yarn';
	if (ua.startsWith('npm/'))
		return 'npm';
	return null;
}

// Pure detector. Split from the async wrapper below so it can be tested
// against fixture directories without mocking clack. `mode` defaults to
// augment so existing callers and augment fixtures keep their exact behavior.
export function inspectPm(cwd: string, env: NodeJS.ProcessEnv = process.env, mode: TargetMode = 'augment'): PmInspection {
	// New-project mode runs against a freshly created, empty directory: no
	// package.json is seeded until writeAndInstall, and no lockfile exists. So
	// we read the user-agent first — npx / `pnpm dlx` / bunx all set
	// npm_config_user_agent, which is how we honor the tool the user reached
	// for. We skip the ancestor walk-up entirely so a stray lockfile in a
	// parent can't pose as intent for a brand-new project, and we never return
	// no-pkg here: falling through to the prompt beats skipping install.
	if (mode === 'new') {
		const uaPm = userAgentSignal(env);
		if (uaPm) {
			return { kind: 'detected', pm: uaPm, source: 'userAgent' };
		}
		return { kind: 'needs-prompt' };
	}

	// Walk up looking for either a workspace marker (refuse) or a lockfile
	// (strongest install-target signal). The workspace check fires on every
	// ancestor *except cwd itself* — being at the workspace root is fine;
	// being in a leaf is what we refuse.
	for (const dir of walkUp(cwd)) {
		if (dir !== cwd && existsSync(join(dir, 'pnpm-workspace.yaml'))) {
			return { kind: 'workspace-leaf', workspaceRoot: dir };
		}
		const sig = lockfileSignal(dir);
		if (sig) {
			return {
				kind: 'detected',
				pm: sig.pm,
				source: 'lockfile',
				lockfilePath: join(dir, sig.file),
			};
		}
	}

	// No lockfile anywhere up the tree. Fall back to cwd's package.json.
	const pkg = readPackageJson(cwd);
	if (pkg === null) {
		return { kind: 'no-pkg' };
	}

	// Corepack-authoritative: a packageManager field beats user-agent because
	// it's the project's stated intent, regardless of what shell invoked us.
	const pmField = parsePackageManagerField(pkg);
	if (pmField) {
		return {
			kind: 'detected',
			pm: pmField.pm,
			source: 'packageManager',
			packageManagerField: pmField.field,
		};
	}

	const uaPm = userAgentSignal(env);
	if (uaPm) {
		return { kind: 'detected', pm: uaPm, source: 'userAgent' };
	}

	return { kind: 'needs-prompt' };
}

// `override` short-circuits detection — config-mode passes the recipe's
// pm field straight through. `null` is a meaningful value (skip install) so
// we check explicitly against undefined. `mode` steers detection: new-project
// runs must read the user-agent instead of the (empty) target directory.
export interface DetectPmOpts {
	override?: Pm | null;
	mode?: TargetMode;
}

// Async wrapper: resolves to the PM we should use, or null when there is no
// package.json (caller writes files only and prints next-steps instructions).
// Throws for workspace-leaf because v1 doesn't support installing into a
// nested workspace package; that lives in v1.1.
export async function detectPm(cwd: string = process.cwd(), opts: DetectPmOpts = {}): Promise<Pm | null> {
	if (opts.override !== undefined)
		return opts.override;
	const inspection = inspectPm(cwd, process.env, opts.mode);

	switch (inspection.kind) {
		case 'detected':
			return inspection.pm;

		case 'no-pkg':
			return null;

		case 'workspace-leaf':
			throw new Error(
				`Detected pnpm workspace at ${inspection.workspaceRoot}. Re-run from the workspace root, or add this package to the workspace manually after.`,
			);

		case 'needs-prompt': {
			const choice = await select<Pm>({
				message: 'Which package manager?',
				options: [
					{ value: 'pnpm', label: 'pnpm' },
					{ value: 'npm', label: 'npm' },
					{ value: 'yarn', label: 'yarn' },
					{ value: 'bun', label: 'bun' },
				],
			});
			if (isCancel(choice)) {
				return cancelAndExit();
			}
			return choice;
		}
	}
}
