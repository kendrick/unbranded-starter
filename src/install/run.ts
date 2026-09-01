import type { Pm } from '../detect/pm';
import type { WriteJournal } from '../fs/journal';
import type { DepCollision, MergeInput } from '../fs/merge-json';
import type { AnyUnit } from '../manifest/types';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { isCancel, log, select, spinner } from '@clack/prompts';
import { collectDepCollisions, depKey, mergePackageJson } from '../fs/merge-json';
import { cancelAndExit } from '../util/cancel';
import { computeNodeVersion, NODE_VERSION_UNIT_ID, queryPmVersion } from './node-version';
import { seedPnpmWorkspace } from './pnpm-builds';
import { spawnOptions } from './spawn';
import { buildRecommendations, VSCODE_UNIT_ID } from './vscode-extensions';

export interface WriteAndInstallOpts {
	targetDir: string;
	pm: Pm | null;
	units: AnyUnit[];
	// When true, every dependency spec is rewritten to the `latest` dist-tag
	// instead of the manifest's pinned version. Off by default (reproducible).
	latest?: boolean;
	// How to settle a dependency whose existing spec differs from the manifest's
	// pin. A set value means the run never prompts, the same contract
	// `--on-conflict` has for files, and what keeps a `--yes` run off a picker.
	onConflict?: 'overwrite' | 'skip';
	// Records pre-run bytes for every path this run writes, so a caller that
	// wants byte-exact rollback on a failed install can offer one. Optional
	// because a caller that isn't offering rollback shouldn't have to build one.
	journal?: WriteJournal;
}

// A file written outside the copy loop, tagged with the unit it belongs to so
// the state file can attribute it (schema 2) — the caller has no other way to
// know which unit a computed path came from.
export interface ComputedWrite {
	path: string;
	unit: string;
}

// A dependency collision and how the run settled it.
export interface DepResolution extends DepCollision {
	resolution: 'overwrite' | 'keep';
}

export interface WriteAndInstallResult {
	wrote: boolean;
	installed: boolean;
	cancelled: boolean;
	// True on a non-zero pm exit as well as a spawn error, the two ways an
	// install genuinely fails. `installed: false` alone can't carry that: it
	// also describes a run that skipped the install, and `error` is set only
	// when the spawn itself never started, so a plain non-zero exit needs its
	// own flag to be visible to the caller at all (#114).
	failed: boolean;
	error?: string;
	// The pm's exit code on a failed run, so a caller can name it in a failure
	// report instead of scraping it back out of terminal output.
	installExitCode?: number;
	// Files written outside the copy loop: the computed .nvmrc and
	// .vscode/extensions.json. Threaded back so writeStateFile can hash them
	// into .unbranded.json; nothing else in the run knows they exist. These land
	// before the install spawn, so the list is complete even on a cancelled install.
	computedWrites: ComputedWrite[];
	// Every dependency whose existing spec differed from the manifest's pin, and
	// which way the run settled it. The run reports these, and keeps them here so
	// a caller can read the outcomes without scraping stdout.
	depResolutions?: DepResolution[];
	// Scripts this run added to package.json that weren't there before—
	// never the user's own, since script merging is existing-wins. package.json
	// is written before the install spawn, so on a failed install these are
	// still sitting live in the file: a lifecycle script like "prepare": "husky"
	// fires unasked on the user's next plain install unless the caller names it
	// (#114).
	addedScripts?: Record<string, string>;
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
			opts.journal?.recordBefore(nvmrcPath);
			writeFileSync(nvmrcPath, pins.nvmrc);
			computedWrites.push({ path: nvmrcPath, unit: NODE_VERSION_UNIT_ID });
		}
	}

	// opt-vscode's extensions.json is computed for the same reason .nvmrc is: the
	// recommendation set only makes sense relative to the units actually picked,
	// so it can't be a static template. Generate it here and union it into any
	// file the user already has.
	if (opts.units.some(u => u.id === VSCODE_UNIT_ID))
		computedWrites.push({ path: writeVscodeExtensions(opts.targetDir, opts.units, opts.journal), unit: VSCODE_UNIT_ID });

	// A pnpm scaffold that pulls a native-build dependency (esbuild, via Vitest)
	// has to allowlist the build or `pnpm install` fails on pnpm 11. Seed the
	// approval before the install spawn below, so our own install sees it, and
	// record it for the state file. All the gating lives in seedPnpmWorkspace.
	const pnpmWorkspace = seedPnpmWorkspace({ targetDir: opts.targetDir, pm: opts.pm, pmVersion, units: opts.units, journal: opts.journal });
	if (pnpmWorkspace)
		computedWrites.push(pnpmWorkspace);

	// A spec the user already chose is a decision, so replacing it in silence is
	// a downgrade they discover by reading the diff: a project pinned to
	// typescript@^6 comes out a major back. Settle each collision before the
	// write, then report every one, the default overwrites included (#113).
	const keepExisting = new Set<string>();
	const depResolutions: DepResolution[] = [];
	for (const collision of collectDepCollisions(existing, patches)) {
		// `--latest` is already the instruction to move every spec, so prompting
		// per package would only ask the user to re-confirm the flag they typed.
		const resolution = opts.latest
			? 'overwrite' as const
			: await resolveDepConflict(collision, opts.onConflict);
		depResolutions.push({ ...collision, resolution });
		if (resolution === 'keep')
			keepExisting.add(depKey(collision));
	}

	const report = formatDepResolutions(depResolutions, Boolean(opts.latest));
	if (report)
		log.info(report);
	// Manifest pins are chosen and tested as a set, so a kept spec leaves
	// package.json holding a combination nobody has run.
	if (depResolutions.some(r => r.resolution === 'keep'))
		log.warn('Kept pins may not match the versions the other manifest deps were tested against.');

	const merged = mergePackageJson(existing, patches, keepExisting);
	// Lifecycle scripts (prepare, postinstall) run unasked on the user's next
	// plain install, so a caller reporting a failure needs to name exactly
	// which ones this run put there—computed against `existing` now, before
	// the write below, since that's the last point either side is still cheap
	// to diff.
	const addedScripts = collectAddedScripts(existing, merged);
	opts.journal?.recordBefore(pkgPath);
	writeFileSync(pkgPath, `${JSON.stringify(merged, null, indent)}\n`);

	if (!opts.pm) {
		return { wrote: true, installed: false, cancelled: false, failed: false, computedWrites, depResolutions, addedScripts };
	}

	const s = spinner();
	s.start(`Installing dependencies via ${opts.pm}`);
	const result = await runInstall(opts.targetDir, opts.pm);

	if (result.cancelled) {
		s.stop('Install interrupted.');
		return { wrote: true, installed: false, cancelled: true, failed: false, computedWrites, depResolutions, addedScripts };
	}
	if (result.success) {
		s.stop('Dependencies installed.');
		return { wrote: true, installed: true, cancelled: false, failed: false, computedWrites, depResolutions, addedScripts };
	}
	// Just closes the spinner. The exit code rides out on the result instead, so
	// the caller's failure report can carry it without saying it twice in a row.
	s.stop('Install failed.');
	return {
		wrote: true,
		installed: false,
		cancelled: false,
		failed: true,
		error: result.error,
		installExitCode: result.code,
		computedWrites,
		depResolutions,
		addedScripts,
	};
}

// The prompt a file conflict gets, minus the diff view: a version collision is
// one line on each side, so both specs fit in the message and a diff would have
// nothing left to show.
async function promptDepConflict(collision: DepCollision): Promise<'overwrite' | 'keep'> {
	const choice = await select<'overwrite' | 'keep'>({
		message: `Conflict: ${collision.section}.${collision.name} is ${collision.existing}, manifest pins ${collision.incoming}`,
		options: [
			{ value: 'overwrite', label: `Overwrite with ${collision.incoming}` },
			{ value: 'keep', label: `Keep ${collision.existing}`, hint: 'may not match sibling manifest pins' },
		],
	});
	if (isCancel(choice))
		return cancelAndExit();
	return choice;
}

// `--on-conflict` says `skip` because that's the vocabulary files use; a
// resolution says `keep` because that's what happened to the dependency. An
// unset policy is the interactive case, and the only one that prompts.
async function resolveDepConflict(
	collision: DepCollision,
	onConflict: 'overwrite' | 'skip' | undefined,
): Promise<'overwrite' | 'keep'> {
	if (onConflict === undefined)
		return promptDepConflict(collision);
	return onConflict === 'skip' ? 'keep' : 'overwrite';
}

// Pure, so it's unit-testable without a whole run. Diffs the merged manifest
// against what package.json had before rather than reading the patches:
// script merging is existing-wins (mergeAdditive in merge-json.ts), so a
// script both a unit and the user already had counts as the user's, and
// reporting it as ours would be wrong regardless of which unit also wanted it.
export function collectAddedScripts(
	existing: Record<string, unknown>,
	merged: Record<string, unknown>,
): Record<string, string> {
	const before = asScripts(existing.scripts);
	const after = asScripts(merged.scripts);
	const added: Record<string, string> = {};
	for (const [name, script] of Object.entries(after)) {
		if (!(name in before))
			added[name] = script;
	}
	return added;
}

function asScripts(value: unknown): Record<string, string> {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? value as Record<string, string>
		: {};
}

// Pure and clack-free, so tests can call it directly. Plain ASCII on purpose:
// nothing here is colorized, so `--no-color` has nothing to strip.
export function formatDepResolutions(resolutions: DepResolution[], latest: boolean): string | null {
	if (resolutions.length === 0)
		return null;

	// Under `--latest` every incoming spec is the same word, so a per-package
	// column would print `latest` N times. The summary counts them instead.
	if (latest)
		return `--latest: rewrote ${resolutions.length} existing dependency spec(s) to 'latest'.`;

	const width = Math.max(...resolutions.map(r => `${r.section}.${r.name}`.length));
	const lines = resolutions.map((r) => {
		const name = `${r.section}.${r.name}`.padEnd(width);
		return r.resolution === 'overwrite'
			? `  overwrote  ${name}  ${r.existing} -> ${r.incoming}`
			: `  kept       ${name}  ${r.existing}  (manifest pins ${r.incoming})`;
	});
	return `package.json dependency conflicts:\n${lines.join('\n')}`;
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
function writeVscodeExtensions(targetDir: string, units: AnyUnit[], journal?: WriteJournal): string {
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
	journal?.recordBefore(path);
	writeFileSync(path, `${JSON.stringify(out, null, indent)}\n`);
	return path;
}

interface InstallResult {
	success: boolean;
	code: number;
	cancelled: boolean;
	error?: string;
}

async function runInstall(cwd: string, pm: Pm): Promise<InstallResult> {
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
