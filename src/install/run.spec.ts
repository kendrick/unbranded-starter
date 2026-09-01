// jsdom (the project default) runs test code in a separate VM context, and
// Vitest's node-builtin mocking hooks the main-realm module loader—under
// jsdom a mocked `spawn` silently falls through to the real binary instead of
// the stub below, so the install-outcome tests would shell out to a real pm.
// This file is pure Node logic with no DOM, so node is also the correct
// environment on its own merits, not just a workaround.
// @vitest-environment node
import type { ChildProcess } from 'node:child_process';
import type { Unit } from '../manifest/types';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isCancel, select } from '@clack/prompts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createJournal } from '../fs/journal';
import { collectAddedScripts, formatDepResolutions, writeAndInstall } from './run';

// `select` is the one TTY prompt a dependency collision drives, so it's the only
// export stubbed; `spinner` and `log` are silent to a test runner and stay real.
// `isCancel` is wrapped rather than replaced so it keeps checking the real cancel
// symbol by default—the one cancel test below overrides it for the case a mocked
// `select` can't produce that symbol on its own.
vi.mock('@clack/prompts', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@clack/prompts')>();
	return { ...actual, select: vi.fn(), isCancel: vi.fn(actual.isCancel) };
});

// Only `spawn` is stubbed, so `spawnOptions` and every other export stay real.
// Every pre-existing test passes `pm: null`, which returns before this is ever
// called—the mock exists purely for the install-outcome tests below, and its
// default no-op implementation would surface as a hang, not a false pass, if
// some other test path started reaching it.
vi.mock('node:child_process', async (importOriginal) => {
	const actual = await importOriginal<typeof import('node:child_process')>();
	return { ...actual, spawn: vi.fn() };
});

// A minimal stand-in for the ChildProcess runInstall and queryPmVersion read:
// `exit`/`error` events and an optional stdout stream. Both callers attach
// their listeners synchronously before this ever fires, so emitting from a
// microtask (after `spawn` returns) is safe.
function fakeChildProcess(): ChildProcess {
	const child = new EventEmitter() as unknown as ChildProcess;
	Object.assign(child, { kill: vi.fn(), killed: false, stdout: new EventEmitter() });
	return child;
}

// Drives both spawn calls a real install makes: queryPmVersion's `pm --version`
// probe (answered with a harmless exit 0, empty stdout, so it never blocks the
// install path under test) and the actual `pm install` spawn, which resolves
// per `outcome`.
function mockInstallSpawn(outcome: { code?: number; error?: string }): void {
	vi.mocked(spawn).mockImplementation((_command, args) => {
		const child = fakeChildProcess();
		const isVersionQuery = Array.isArray(args) && args.includes('--version');
		queueMicrotask(() => {
			if (isVersionQuery) {
				child.emit('exit', 0);
				return;
			}
			if (outcome.error !== undefined)
				child.emit('error', new Error(outcome.error));
			else
				child.emit('exit', outcome.code ?? 0);
		});
		return child;
	});
}

const NODE_MAJOR = process.versions.node.split('.')[0];

const NODE_UNIT: Unit = {
	id: 'core-node-version',
	category: 'foundation',
	label: 'Node version',
	description: '',
	files: [],
};

const UNIT: Unit = {
	id: 'core-eslint',
	category: 'lint',
	label: 'ESLint',
	description: '',
	files: [],
	dependencies: { clsx: '2.1.1' },
	devDependencies: { eslint: '9.39.4', typescript: '5.9.3' },
};

describe('writeAndInstall version policy', () => {
	let tmp: string;

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-run-'));
	});

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	function writtenPkg(): { dependencies: Record<string, string>; devDependencies: Record<string, string> } {
		return JSON.parse(readFileSync(join(tmp, 'package.json'), 'utf-8')) as {
			dependencies: Record<string, string>;
			devDependencies: Record<string, string>;
		};
	}

	it('keeps the manifest pins by default', async () => {
		// pm:null means it writes package.json and skips the install spawn.
		await writeAndInstall({ targetDir: tmp, pm: null, units: [UNIT] });
		expect(writtenPkg().devDependencies).toMatchObject({ eslint: '9.39.4', typescript: '5.9.3' });
		expect(writtenPkg().dependencies).toMatchObject({ clsx: '2.1.1' });
	});

	it('rewrites every dependency to the latest tag when latest is set', async () => {
		await writeAndInstall({ targetDir: tmp, pm: null, units: [UNIT], latest: true });
		expect(writtenPkg().devDependencies).toEqual({ eslint: 'latest', typescript: 'latest' });
		expect(writtenPkg().dependencies).toEqual({ clsx: 'latest' });
	});

	it('pins .nvmrc and engines from the running node major when core-node-version is selected', async () => {
		// pm:null means no install spawn and no packageManager query, so the pin
		// is node-only — exactly the "no package.json to detect a pm from" case.
		const result = await writeAndInstall({ targetDir: tmp, pm: null, units: [NODE_UNIT] });
		expect(readFileSync(join(tmp, '.nvmrc'), 'utf-8')).toBe(`${NODE_MAJOR}\n`);
		const pkg = JSON.parse(readFileSync(join(tmp, 'package.json'), 'utf-8')) as {
			engines?: { node?: string };
			packageManager?: string;
		};
		expect(pkg.engines).toEqual({ node: `>=${NODE_MAJOR}` });
		expect(pkg.packageManager).toBeUndefined();
		// Reported back for the state file: this computed file lands after the copy
		// loop, so the caller can't know it exists any other way.
		expect(result.computedWrites).toContainEqual({ path: join(tmp, '.nvmrc'), unit: 'core-node-version' });
	});

	it('never clobbers an existing .nvmrc — and does not claim to have written it', async () => {
		writeFileSync(join(tmp, '.nvmrc'), '18\n');
		const result = await writeAndInstall({ targetDir: tmp, pm: null, units: [NODE_UNIT] });
		expect(readFileSync(join(tmp, '.nvmrc'), 'utf-8')).toBe('18\n');
		// We didn't write it, so it must not be tracked, otherwise diff would flag
		// the user's own .nvmrc as drift against a hash we never laid down.
		expect(result.computedWrites.map(w => w.path)).not.toContain(join(tmp, '.nvmrc'));
	});

	it('leaves .nvmrc alone when core-node-version is not selected', async () => {
		const result = await writeAndInstall({ targetDir: tmp, pm: null, units: [UNIT] });
		expect(existsSync(join(tmp, '.nvmrc'))).toBe(false);
		expect(result.computedWrites).toEqual([]);
	});
});

const VSCODE_UNIT: Unit = { id: 'opt-vscode', category: 'editor', label: 'VS Code', description: '', files: [] };
const ESLINT_REC: Unit = { ...UNIT, recommendedExtensions: ['dbaeumer.vscode-eslint'] };
const EDITORCONFIG_REC: Unit = {
	id: 'core-editorconfig',
	category: 'foundation',
	label: '',
	description: '',
	files: [],
	recommendedExtensions: ['editorconfig.editorconfig'],
};

describe('writeAndInstall vscode extensions', () => {
	let tmp: string;

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-run-vscode-'));
	});

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	function readExtensions(): { recommendations: string[]; [k: string]: unknown } {
		return JSON.parse(readFileSync(join(tmp, '.vscode', 'extensions.json'), 'utf-8')) as {
			recommendations: string[];
			[k: string]: unknown;
		};
	}

	it('generates .vscode/extensions.json from the selected units when opt-vscode is chosen', async () => {
		const result = await writeAndInstall({ targetDir: tmp, pm: null, units: [VSCODE_UNIT, ESLINT_REC, EDITORCONFIG_REC] });
		expect(readExtensions().recommendations).toEqual([
			'dbaeumer.vscode-eslint',
			'editorconfig.editorconfig',
		]);
		// The computed extensions.json is reported for the state file too.
		expect(result.computedWrites).toContainEqual({ path: join(tmp, '.vscode', 'extensions.json'), unit: 'opt-vscode' });
	});

	it('unions into an existing extensions.json without clobbering its entries or sibling keys', async () => {
		mkdirSync(join(tmp, '.vscode'), { recursive: true });
		writeFileSync(
			join(tmp, '.vscode', 'extensions.json'),
			`${JSON.stringify({ recommendations: ['acme.custom'], unwantedRecommendations: ['bad.ext'] }, null, '\t')}\n`,
		);
		await writeAndInstall({ targetDir: tmp, pm: null, units: [VSCODE_UNIT, ESLINT_REC] });
		const ext = readExtensions();
		expect(ext.recommendations).toEqual(['acme.custom', 'dbaeumer.vscode-eslint']);
		// A sibling key the user maintains must survive the computed rewrite.
		expect(ext.unwantedRecommendations).toEqual(['bad.ext']);
	});

	it('writes nothing when opt-vscode is not selected', async () => {
		const result = await writeAndInstall({ targetDir: tmp, pm: null, units: [ESLINT_REC] });
		expect(existsSync(join(tmp, '.vscode', 'extensions.json'))).toBe(false);
		expect(result.computedWrites).toEqual([]);
	});
});

describe('writeAndInstall dependency conflicts (#113)', () => {
	let tmp: string;

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-run-conflict-'));
		// `mockClear` only, not `mockReset`—`isCancel` keeps delegating to the real
		// implementation from the module factory unless a test overrides it below.
		vi.mocked(select).mockReset();
		vi.mocked(isCancel).mockClear();
	});

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	function writtenPkg(): { dependencies: Record<string, string>; devDependencies: Record<string, string> } {
		return JSON.parse(readFileSync(join(tmp, 'package.json'), 'utf-8')) as {
			dependencies: Record<string, string>;
			devDependencies: Record<string, string>;
		};
	}

	function seedConflict(devDependencies: Record<string, string> = { typescript: '^6.0.3' }): void {
		writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'x', devDependencies }));
	}

	it('overwrites a conflicting pin under onConflict:"overwrite", reporting the resolution', async () => {
		seedConflict();
		const result = await writeAndInstall({ targetDir: tmp, pm: null, units: [UNIT], onConflict: 'overwrite' });
		expect(writtenPkg().devDependencies.typescript).toBe('5.9.3');
		expect(result.depResolutions).toEqual([
			{ section: 'devDependencies', name: 'typescript', existing: '^6.0.3', incoming: '5.9.3', resolution: 'overwrite' },
		]);
		expect(select).not.toHaveBeenCalled();
	});

	it('keeps a conflicting pin under onConflict:"skip", without disturbing sibling deps', async () => {
		seedConflict();
		const result = await writeAndInstall({ targetDir: tmp, pm: null, units: [UNIT], onConflict: 'skip' });
		expect(writtenPkg().devDependencies.typescript).toBe('^6.0.3');
		expect(result.depResolutions).toEqual([
			{ section: 'devDependencies', name: 'typescript', existing: '^6.0.3', incoming: '5.9.3', resolution: 'keep' },
		]);
		expect(select).not.toHaveBeenCalled();
		// No-cascade guarantee: settling the typescript collision must never touch
		// eslint or clsx, which weren't collisions and so still land at their pins.
		expect(writtenPkg().devDependencies.eslint).toBe('9.39.4');
		expect(writtenPkg().dependencies.clsx).toBe('2.1.1');
	});

	it('prompts per colliding dep when onConflict is unset, and applies the chosen resolution', async () => {
		seedConflict();
		vi.mocked(select).mockResolvedValueOnce('keep');
		const result = await writeAndInstall({ targetDir: tmp, pm: null, units: [UNIT] });
		expect(select).toHaveBeenCalledTimes(1);
		expect(writtenPkg().devDependencies.typescript).toBe('^6.0.3');
		expect(result.depResolutions).toEqual([
			{ section: 'devDependencies', name: 'typescript', existing: '^6.0.3', incoming: '5.9.3', resolution: 'keep' },
		]);
	});

	it('exits 130 and writes nothing when the conflict prompt is cancelled', async () => {
		const original = JSON.stringify({ name: 'x', devDependencies: { typescript: '^6.0.3' } });
		writeFileSync(join(tmp, 'package.json'), original);

		// Driving `select` to resolve the real clack cancel symbol means driving an
		// actual prompt; mocking `isCancel` true for this one case is the documented
		// fallback for exercising the cancel path without a TTY.
		vi.mocked(isCancel).mockReturnValueOnce(true);

		// Unlike detectTarget's cancel test, this collision loop doesn't `return` on
		// cancel—resolveDepConflict's resolved value just flows on as data—so a
		// non-throwing exit stub would let the loop fall through and still write
		// package.json. Throwing reproduces process.exit's real never-returns
		// behavior, which is what actually stops the write in production.
		const exit = vi.spyOn(process, 'exit').mockImplementation(() => {
			throw new Error('process.exit');
		});

		// Restore in `finally`: this suite has no restoreMocks, so a failed
		// assertion here would otherwise leave process.exit throwing for the
		// rest of the file.
		try {
			await expect(writeAndInstall({ targetDir: tmp, pm: null, units: [UNIT] })).rejects.toThrow('process.exit');

			expect(exit).toHaveBeenCalledWith(130);
			expect(readFileSync(join(tmp, 'package.json'), 'utf-8')).toBe(original);
		}
		finally {
			exit.mockRestore();
		}
	});

	it('auto-resolves every existing pin to overwrite under --latest, no prompt', async () => {
		writeFileSync(join(tmp, 'package.json'), JSON.stringify({
			name: 'x',
			dependencies: { clsx: '2.0.0' },
			devDependencies: { typescript: '^6.0.3' },
		}));
		const result = await writeAndInstall({ targetDir: tmp, pm: null, units: [UNIT], latest: true });
		expect(select).not.toHaveBeenCalled();
		expect(result.depResolutions).toEqual([
			{ section: 'dependencies', name: 'clsx', existing: '2.0.0', incoming: 'latest', resolution: 'overwrite' },
			{ section: 'devDependencies', name: 'typescript', existing: '^6.0.3', incoming: 'latest', resolution: 'overwrite' },
		]);
	});

	it('is idempotent—a rerun with the same unit reports no collisions and never prompts', async () => {
		await writeAndInstall({ targetDir: tmp, pm: null, units: [UNIT] });
		// Equal specs aren't collisions (collectDepCollisions), so without that a
		// rerun of the same units would re-prompt and re-report pins that never moved.
		const second = await writeAndInstall({ targetDir: tmp, pm: null, units: [UNIT] });
		expect(second.depResolutions).toEqual([]);
		expect(select).not.toHaveBeenCalled();
	});
});

describe('formatDepResolutions', () => {
	it('returns null for an empty resolution list', () => {
		expect(formatDepResolutions([], false)).toBeNull();
	});

	it('renders both overwrote and kept lines for a mixed set', () => {
		const out = formatDepResolutions([
			{ section: 'devDependencies', name: 'typescript', existing: '^6.0.3', incoming: '5.9.3', resolution: 'overwrite' },
			{ section: 'dependencies', name: 'clsx', existing: '2.0.0', incoming: '2.1.1', resolution: 'keep' },
		], false);
		expect(out).toContain('package.json dependency conflicts:');
		expect(out).toMatch(/overwrote\s+devDependencies\.typescript\s+\^6\.0\.3 -> 5\.9\.3/);
		expect(out).toMatch(/kept\s+dependencies\.clsx\s+2\.0\.0\s+\(manifest pins 2\.1\.1\)/);
	});

	it('renders the one-line --latest summary with the resolution count', () => {
		const out = formatDepResolutions([
			{ section: 'devDependencies', name: 'typescript', existing: '^6.0.3', incoming: 'latest', resolution: 'overwrite' },
			{ section: 'dependencies', name: 'clsx', existing: '2.0.0', incoming: 'latest', resolution: 'overwrite' },
		], true);
		expect(out).toBe('--latest: rewrote 2 existing dependency spec(s) to \'latest\'.');
	});
});

describe('writeAndInstall install outcome (#114)', () => {
	let tmp: string;

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-run-install-'));
		vi.mocked(spawn).mockReset();
	});

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	it('reports the failure and exit code when the pm exits non-zero, instead of an all-clear', async () => {
		mockInstallSpawn({ code: 2 });
		const result = await writeAndInstall({ targetDir: tmp, pm: 'npm', units: [UNIT] });
		expect(result).toMatchObject({ failed: true, installExitCode: 2, installed: false, cancelled: false });
	});

	it('reports the failure and the spawn error when the pm binary cannot even run', async () => {
		mockInstallSpawn({ error: 'spawn npm ENOENT' });
		const result = await writeAndInstall({ targetDir: tmp, pm: 'npm', units: [UNIT] });
		expect(result.failed).toBe(true);
		expect(result.error).toBe('spawn npm ENOENT');
	});

	it('reports failed:false and installed:true on a clean install', async () => {
		mockInstallSpawn({ code: 0 });
		const result = await writeAndInstall({ targetDir: tmp, pm: 'npm', units: [UNIT] });
		expect(result.failed).toBe(false);
		expect(result.installed).toBe(true);
	});
});

describe('collectAddedScripts', () => {
	it('reports a script the merge added', () => {
		const existing = { scripts: { build: 'tsc' } };
		const merged = { scripts: { build: 'tsc', lint: 'eslint .' } };
		expect(collectAddedScripts(existing, merged)).toEqual({ lint: 'eslint .' });
	});

	it('does not report a script the user already had—existing-wins means it was never ours to add', () => {
		const existing = { scripts: { prepare: 'my-own-hook' } };
		// mergePackageJson's mergeAdditive leaves a pre-existing script untouched,
		// so this is what the merged manifest actually looks like in that case.
		const merged = { scripts: { prepare: 'my-own-hook' } };
		expect(collectAddedScripts(existing, merged)).toEqual({});
	});

	it('returns empty when the merge adds no scripts', () => {
		const existing = { scripts: { build: 'tsc' } };
		const merged = { scripts: { build: 'tsc' } };
		expect(collectAddedScripts(existing, merged)).toEqual({});
	});
});

describe('writeAndInstall journal integration (#114)', () => {
	let tmp: string;

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-run-journal-'));
	});

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	it('journals the exact prior bytes of an existing package.json on an augment run', async () => {
		const original = JSON.stringify({ name: 'x', version: '1.0.0' });
		writeFileSync(join(tmp, 'package.json'), original);
		const journal = createJournal();
		await writeAndInstall({ targetDir: tmp, pm: null, units: [UNIT], journal });
		const entry = journal.entries().find(e => e.path === join(tmp, 'package.json'));
		expect(entry?.before?.toString('utf-8')).toBe(original);
	});

	it('journals before:null for package.json on a new-project run', async () => {
		const journal = createJournal();
		await writeAndInstall({ targetDir: tmp, pm: null, units: [UNIT], journal });
		const entry = journal.entries().find(e => e.path === join(tmp, 'package.json'));
		expect(entry?.before).toBeNull();
	});

	it('journals a written .nvmrc', async () => {
		const journal = createJournal();
		await writeAndInstall({ targetDir: tmp, pm: null, units: [NODE_UNIT], journal });
		const entry = journal.entries().find(e => e.path === join(tmp, '.nvmrc'));
		expect(entry?.before).toBeNull();
	});
});
