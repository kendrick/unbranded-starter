import type { Pm } from '../detect/pm';
import type { MergeInput } from '../fs/merge-json';
import type { Unit, UnitId } from '../manifest/types';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { spinner } from '@clack/prompts';
import { mergePackageJson } from '../fs/merge-json';
import { computeNodeVersion, NODE_VERSION_UNIT_ID, queryPmVersion } from './node-version';
import { seedPnpmWorkspace } from './pnpm-builds';
import { spawnOptions } from './spawn';
import { buildRecommendations, VSCODE_UNIT_ID } from './vscode-extensions';

export interface WriteAndInstallOpts {
	targetDir: string;
	pm: Pm | null;
	units: Unit[];
	// When true, every dependency spec is rewritten to the `latest` dist-tag
	// instead of the manifest's pinned version. Off by default (reproducible).
	latest?: boolean;
}

// A file written outside the copy loop, tagged with the unit it belongs to so
// the state file can attribute it (schema 2) — the caller has no other way to
// know which unit a computed path came from.
export interface ComputedWrite {
	path: string;
	unit: UnitId;
}

export interface WriteAndInstallResult {
	wrote: boolean;
	installed: boolean;
	cancelled: boolean;
	error?: string;
	// Files written outside the copy loop: the computed .nvmrc and
	// .vscode/extensions.json. Threaded back so writeStateFile can hash them
	// into .unbranded.json; nothing else in the run knows they exist. These land
	// before the install spawn, so the list is complete even on a cancelled install.
	computedWrites: ComputedWrite[];
}

export async function writeAndInstall(opts: WriteAndInstallOpts): Promise<WriteAndInstallResult> {
	const pkgPath = join(opts.targetDir, 'package.json');
	const had = existsSync(pkgPath);
	const raw = had ? readFileSync(pkgPath, 'utf-8') : '';

	// Seed a minimal package.json for new-project mode. `name` defaults to the
	// directory's basename, which matches what `npm init -y` does.
	const existing: Record<string, unknown> = had
		? (JSON.parse(raw) as Record<string, unknown>)
		: { name: basename(opts.targetDir), version: '0.0.0', type: 'module' };

	// Fresh seed uses a tab, which is what the ESLint config unbranded ships expects
	// (antfu's jsonc/indent), so a new scaffold lints clean without a fix pass (#48).
	// Augment keeps detectIndent, so we never reformat a file the user already has.
	const indent = had ? detectIndent(raw) : '\t';

	// Files this run writes outside the copy loop, collected for the state file.
	const computedWrites: ComputedWrite[] = [];

	const patches: MergeInput[] = opts.units.map(u => ({
		dependencies: opts.latest ? toLatest(u.dependencies) : u.dependencies,
		devDependencies: opts.latest ? toLatest(u.devDependencies) : u.devDependencies,
		scripts: u.packageJsonPatch?.scripts,
		engines: u.packageJsonPatch?.engines,
		packageManager: u.packageJsonPatch?.packageManager,
	}));

	// The pm's real version drives two computed outputs below: core-node-version's
	// packageManager pin and the pnpm build-script allowlist (whose shape differs
	// between pnpm 10 and 11). Query it once; it's null for a null pm or on failure.
	const pmVersion = await queryPmVersion(opts.pm, opts.targetDir);

	// core-node-version can't ship its output as a static template: .nvmrc,
	// engines, and packageManager all have to reflect the running environment.
	// Materialize it here, appending a computed patch and writing .nvmrc, so a
	// single source drives all three and existing user pins still win the merge.
	if (opts.units.some(u => u.id === NODE_VERSION_UNIT_ID)) {
		const pins = computeNodeVersion({
			nodeVersion: process.versions.node,
			pm: opts.pm,
			pmVersion,
		});
		patches.push({ engines: pins.engines, packageManager: pins.packageManager });
		const nvmrcPath = join(opts.targetDir, '.nvmrc');
		// Existing user pins win, so we only write .nvmrc when the user doesn't
		// already have one, and only track it when we actually wrote it. Recording a
		// file we didn't write would make diff flag the user's own .nvmrc as drift
		// against a hash we never laid down.
		if (!existsSync(nvmrcPath)) {
			writeFileSync(nvmrcPath, pins.nvmrc);
			computedWrites.push({ path: nvmrcPath, unit: NODE_VERSION_UNIT_ID });
		}
	}

	// opt-vscode's extensions.json is computed for the same reason .nvmrc is: the
	// recommendation set only makes sense relative to the units actually picked,
	// so it can't be a static template. Generate it here and union it into any
	// file the user already has.
	if (opts.units.some(u => u.id === VSCODE_UNIT_ID))
		computedWrites.push({ path: writeVscodeExtensions(opts.targetDir, opts.units), unit: VSCODE_UNIT_ID });

	// A pnpm scaffold that pulls a native-build dependency (esbuild, via Vitest)
	// has to allowlist the build or `pnpm install` fails on pnpm 11. Seed the
	// approval before the install spawn below, so our own install sees it, and
	// record it for the state file. All the gating lives in seedPnpmWorkspace.
	const pnpmWorkspace = seedPnpmWorkspace({ targetDir: opts.targetDir, pm: opts.pm, pmVersion, units: opts.units });
	if (pnpmWorkspace)
		computedWrites.push(pnpmWorkspace);

	const merged = mergePackageJson(existing, patches);
	writeFileSync(pkgPath, `${JSON.stringify(merged, null, indent)}\n`);

	if (!opts.pm) {
		return { wrote: true, installed: false, cancelled: false, computedWrites };
	}

	const s = spinner();
	s.start(`Installing dependencies via ${opts.pm}`);
	const result = await runInstall(opts.targetDir, opts.pm);

	if (result.cancelled) {
		s.stop('Install interrupted.');
		return { wrote: true, installed: false, cancelled: true, computedWrites };
	}
	if (result.success) {
		s.stop('Dependencies installed.');
		return { wrote: true, installed: true, cancelled: false, computedWrites };
	}
	s.stop(`Install failed (exit ${result.code}).`);
	return { wrote: true, installed: false, cancelled: false, error: result.error, computedWrites };
}

// The `--latest` escape hatch rewrites every pinned spec to the `latest`
// dist-tag, so the install resolves the newest published versions. The lockfile
// still records what actually resolved, so a single run stays reproducible.
function toLatest(deps: Record<string, string> | undefined): Record<string, string> | undefined {
	if (!deps)
		return deps;
	return Object.fromEntries(Object.keys(deps).map(name => [name, 'latest']));
}

// Match the existing file's indentation so we don't reformat what the user
// (or a prior tool) chose. Defaults to two spaces, which is what `npm init`
// emits and what most package.json files in the wild use. Exported because
// remove's package.json rewrite has the same don't-reformat obligation.
export function detectIndent(content: string): string {
	for (const line of content.split('\n')) {
		const match = /^([ \t]+)\S/.exec(line);
		if (match?.[1])
			return match[1];
	}
	return '  ';
}

// Materialize .vscode/extensions.json from the selected units. A fresh file
// defaults to tab indent so it matches the settings.json opt-vscode ships;
// when the user already has one we detect their indent, keep their existing
// `recommendations` (and any sibling keys like unwantedRecommendations), and
// only fold our additions in. Returns the path written so the caller can record it.
function writeVscodeExtensions(targetDir: string, units: Unit[]): string {
	const dir = join(targetDir, '.vscode');
	const path = join(dir, 'extensions.json');

	let base: Record<string, unknown> = {};
	let existing: string[] = [];
	let indent = '\t';
	if (existsSync(path)) {
		const raw = readFileSync(path, 'utf-8');
		base = JSON.parse(raw) as Record<string, unknown>;
		if (Array.isArray(base.recommendations))
			existing = base.recommendations.filter((v): v is string => typeof v === 'string');
		indent = detectIndent(raw);
	}

	// Spread base first so a user's sibling keys survive; `recommendations` then
	// overwrites in place (or appends if the file never had it).
	const out = { ...base, recommendations: buildRecommendations(units, existing) };
	mkdirSync(dir, { recursive: true });
	writeFileSync(path, `${JSON.stringify(out, null, indent)}\n`);
	return path;
}

interface InstallResult {
	success: boolean;
	code: number;
	cancelled: boolean;
	error?: string;
}

function runInstall(cwd: string, pm: Pm): Promise<InstallResult> {
	return new Promise((resolve) => {
		const child = spawn(pm, ['install'], spawnOptions(cwd));
		let cancelled = false;

		// Catch Ctrl-C while install is running. Send SIGTERM first for a clean
		// shutdown; escalate to SIGKILL after a grace period if the PM ignores
		// it. The .unref() lets the process exit before the timer fires when
		// the child does shut down cleanly.
		const onSigint = (): void => {
			cancelled = true;
			child.kill('SIGTERM');
			setTimeout(() => {
				if (!child.killed)
					child.kill('SIGKILL');
			}, 5000).unref();
		};
		process.on('SIGINT', onSigint);

		child.on('exit', (code) => {
			process.off('SIGINT', onSigint);
			resolve({
				success: code === 0,
				code: code ?? 1,
				cancelled,
			});
		});

		child.on('error', (err) => {
			process.off('SIGINT', onSigint);
			resolve({
				success: false,
				code: 1,
				cancelled,
				error: err.message,
			});
		});
	});
}
