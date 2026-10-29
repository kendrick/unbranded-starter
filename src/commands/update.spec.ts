import type { Unit, UnitId } from '../manifest/types';
import type { StateFile } from '../state/state';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { log } from '@clack/prompts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildTsconfigBase } from '../manifest/tsconfig-base';
import {
	baselinePath,
	builtinUnits,
	hashBuffer,
	legacyBaselinePath,
	STATE_SCHEMA,
} from '../state/state';
import { planUpdate, runUpdate } from './update';

function unit(id: UnitId, extras: Partial<Unit> = {}): Unit {
	return { id, category: 'lint', label: id, description: '', files: [], ...extras };
}

function h(content: string): string {
	return hashBuffer(Buffer.from(content));
}

const OLD = 'line one\nline two\nline three\n';
const NEW = 'line one CHANGED\nline two\nline three\n';

describe('planUpdate', () => {
	let tmp: string;

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-update-plan-'));
	});

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	// The template ships NEW; the recorded baseline (and hash) say the scaffold
	// wrote OLD — i.e. the template moved on since this project scaffolded.
	const catalog = [unit('core-editorconfig', { files: [{ content: NEW, dest: 'config.txt' }] })];

	function state(overrides: Partial<StateFile> = {}): StateFile {
		return {
			_tool: 'x',
			schema: STATE_SCHEMA,
			version: '0.7.0',
			units: builtinUnits(['core-editorconfig']),
			files: { 'config.txt': h(OLD) },
			attribution: { 'config.txt': 'core-editorconfig' },
			modes: { 'config.txt': 'copy' },
			...overrides,
		};
	}

	function writeBaseline(content: string, path = baselinePath(tmp, 'config.txt')): void {
		mkdirSync(join(tmp, '.unbranded', 'baseline'), { recursive: true });
		writeFileSync(path, content);
	}

	it('marks an untouched file as a clean-update carrying the new template', () => {
		writeFileSync(join(tmp, 'config.txt'), OLD);
		writeBaseline(OLD);
		const { files } = planUpdate({ targetDir: tmp, state: state(), units: catalog, pkgRoot: tmp });
		expect(files).toEqual([
			{ rel: 'config.txt', status: 'clean-update', proposed: NEW, theirs: NEW, existing: OLD },
		]);
	});

	it('merges against a baseline stored only at the legacy, unsuffixed name', () => {
		// Pre-#182 scaffolds have no `.base` copy. Seeding only the legacy name
		// proves the fallback read, since the hash fallback can't stand in here.
		writeFileSync(join(tmp, 'config.txt'), `${OLD}user line\n`);
		writeBaseline(OLD, legacyBaselinePath(tmp, 'config.txt'));
		expect(existsSync(baselinePath(tmp, 'config.txt'))).toBe(false);
		const { files } = planUpdate({
			targetDir: tmp,
			state: state({ schema: 3, files: { 'config.txt': h('not the disk bytes') } }),
			units: catalog,
			pkgRoot: tmp,
		});
		expect(files[0]?.status).toBe('merged');
		expect(files[0]?.proposed).toBe(`${NEW}user line\n`);
	});

	it('reads a schema-3 legacy copy even when a `.base` name sits beside it', () => {
		// In a schema-3 sidecar, `config.txt.base` is the legacy copy of a tracked file
		// by that name, never `config.txt`'s merge base.
		writeFileSync(join(tmp, 'config.txt'), `${OLD}user line\n`);
		writeBaseline(OLD, legacyBaselinePath(tmp, 'config.txt'));
		writeBaseline('some other file entirely\n', baselinePath(tmp, 'config.txt'));
		const { files } = planUpdate({
			targetDir: tmp,
			state: state({ schema: 3, files: { 'config.txt': h('not the disk bytes') } }),
			units: catalog,
			pkgRoot: tmp,
		});
		expect(files[0]?.status).toBe('merged');
		expect(files[0]?.proposed).toBe(`${NEW}user line\n`);
	});

	it('is up-to-date when the template never moved, whatever the user did', () => {
		writeFileSync(join(tmp, 'config.txt'), 'user rewrote everything\n');
		writeBaseline(NEW); // baseline already matches the shipped template
		const { files } = planUpdate({
			targetDir: tmp,
			state: state({ files: { 'config.txt': h(NEW) } }),
			units: catalog,
			pkgRoot: tmp,
		});
		expect(files[0]?.status).toBe('up-to-date');
	});

	it('three-way merges non-overlapping user edits with the template change', () => {
		writeFileSync(join(tmp, 'config.txt'), `${OLD}user line\n`);
		writeBaseline(OLD);
		const { files } = planUpdate({ targetDir: tmp, state: state(), units: catalog, pkgRoot: tmp });
		expect(files[0]?.status).toBe('merged');
		expect(files[0]?.proposed).toBe(`${NEW}user line\n`);
	});

	it('flags overlapping edits as a conflict with marker text ready', () => {
		writeFileSync(join(tmp, 'config.txt'), 'line one MINE\nline two\nline three\n');
		writeBaseline(OLD);
		const { files } = planUpdate({ targetDir: tmp, state: state(), units: catalog, pkgRoot: tmp });
		expect(files[0]?.status).toBe('conflict');
		expect(files[0]?.proposed).toContain('<<<<<<< yours');
		expect(files[0]?.theirs).toBe(NEW);
	});

	it('degrades a modified file without a baseline to needs-choice', () => {
		// Schema-1 scaffold (or a deleted sidecar): no merge base exists, and the
		// file no longer matches the recorded hash — only ours/theirs remains.
		writeFileSync(join(tmp, 'config.txt'), 'line one MINE\nline two\nline three\n');
		const { files } = planUpdate({ targetDir: tmp, state: state(), units: catalog, pkgRoot: tmp });
		expect(files[0]?.status).toBe('needs-choice');
		expect(files[0]?.proposed).toBe(NEW);
	});

	it('treats a hash-matching file without a baseline as its own base', () => {
		// The recorded hash proves the disk bytes are exactly what we wrote, so
		// the disk IS the base and the update is clean.
		writeFileSync(join(tmp, 'config.txt'), OLD);
		const { files } = planUpdate({ targetDir: tmp, state: state(), units: catalog, pkgRoot: tmp });
		expect(files[0]?.status).toBe('clean-update');
		expect(files[0]?.proposed).toBe(NEW);
	});

	it('routes merge-json files through the structured merge, never text', () => {
		const jsonCatalog = [
			unit('opt-vscode', {
				files: [
					{ content: '{\n\t"a": 1,\n\t"b": 2\n}\n', dest: 'settings.json', mode: 'merge-json' },
				],
			}),
		];
		writeFileSync(join(tmp, 'settings.json'), '{\n\t"a": 1,\n\t"user": true\n}\n');
		const s = state({
			units: builtinUnits(['opt-vscode']),
			files: { 'settings.json': h('irrelevant') },
			attribution: { 'settings.json': 'opt-vscode' },
			modes: { 'settings.json': 'merge-json' },
		});
		const { files } = planUpdate({ targetDir: tmp, state: s, units: jsonCatalog, pkgRoot: tmp });
		expect(files[0]?.status).toBe('merged');
		expect(JSON.parse(files[0]?.proposed ?? '')).toEqual({ a: 1, user: true, b: 2 });
	});

	it('reports a merge-json file that is not strict JSON as unparseable, not up-to-date (#216)', () => {
		const jsonCatalog = [
			unit('opt-vscode', {
				files: [{ content: '{\n\t"a": 2\n}\n', dest: 'settings.json', mode: 'merge-json' }],
			}),
		];
		writeFileSync(join(tmp, 'settings.json'), '{\n\t// note\n\t"a": 1\n}\n');
		const s = state({
			units: builtinUnits(['opt-vscode']),
			files: { 'settings.json': h('irrelevant') },
			attribution: { 'settings.json': 'opt-vscode' },
			modes: { 'settings.json': 'merge-json' },
		});
		const { files } = planUpdate({ targetDir: tmp, state: s, units: jsonCatalog, pkgRoot: tmp });
		expect(files[0]?.status).toBe('unparseable');
	});

	it('surfaces a merge-json value collision as needs-choice', () => {
		const jsonCatalog = [
			unit('opt-vscode', {
				files: [{ content: '{\n\t"a": 2\n}\n', dest: 'settings.json', mode: 'merge-json' }],
			}),
		];
		writeFileSync(join(tmp, 'settings.json'), '{\n\t"a": 1\n}\n');
		const s = state({
			units: builtinUnits(['opt-vscode']),
			files: { 'settings.json': h('irrelevant') },
			attribution: { 'settings.json': 'opt-vscode' },
			modes: { 'settings.json': 'merge-json' },
		});
		const { files } = planUpdate({ targetDir: tmp, state: s, units: jsonCatalog, pkgRoot: tmp });
		expect(files[0]?.status).toBe('needs-choice');
	});

	it('re-appends template lines an append-if-missing file lost', () => {
		const appendCatalog = [
			unit('core-gitattributes', {
				files: [
					{ content: 'rule one\nrule two\n', dest: '.gitattributes', mode: 'append-if-missing' },
				],
			}),
		];
		writeFileSync(join(tmp, '.gitattributes'), 'rule one\nuser rule\n');
		const s = state({
			units: builtinUnits(['core-gitattributes']),
			files: { '.gitattributes': h('irrelevant') },
			attribution: { '.gitattributes': 'core-gitattributes' },
			modes: { '.gitattributes': 'append-if-missing' },
		});
		const { files } = planUpdate({ targetDir: tmp, state: s, units: appendCatalog, pkgRoot: tmp });
		expect(files[0]?.status).toBe('merged');
		expect(files[0]?.proposed).toBe('rule one\nuser rule\nrule two\n');
	});

	it('reports template-gone, user-deleted, and computed files without acting', () => {
		writeFileSync(join(tmp, 'orphan.txt'), 'x\n');
		const s = state({
			units: builtinUnits(['core-editorconfig', 'core-node-version']),
			files: { 'orphan.txt': h('x\n'), 'config.txt': h(OLD), '.nvmrc': h('22\n') },
			attribution: {
				'orphan.txt': 'core-editorconfig',
				'config.txt': 'core-editorconfig',
				'.nvmrc': 'core-node-version',
			},
			modes: { 'orphan.txt': 'copy', 'config.txt': 'copy', '.nvmrc': 'computed' },
		});
		const { files } = planUpdate({ targetDir: tmp, state: s, units: catalog, pkgRoot: tmp });
		const byRel = new Map(files.map((f) => [f.rel, f.status]));
		expect(byRel.get('orphan.txt')).toBe('template-gone');
		expect(byRel.get('config.txt')).toBe('user-deleted');
		expect(byRel.get('.nvmrc')).toBe('computed');
	});

	it('recomputes package.json through the structured merge and reports drift', () => {
		const pkgCatalog = [
			unit('core-vitest', {
				devDependencies: { vitest: '2.1.9' },
				packageJsonPatch: { scripts: { 'test': 'vitest run', 'test:watch': 'vitest' } },
			}),
		];
		// The user deleted test:watch and the vitest dep; update restores both.
		writeFileSync(
			join(tmp, 'package.json'),
			`${JSON.stringify({ name: 'x', scripts: { test: 'vitest run' } }, null, '\t')}\n`,
		);
		const s = state({
			units: builtinUnits(['core-vitest']),
			files: {},
			attribution: {},
			modes: {},
		});

		const { pkg } = planUpdate({ targetDir: tmp, state: s, units: pkgCatalog, pkgRoot: tmp });
		expect(pkg.changed).toBe(true);
		const proposed = JSON.parse(pkg.proposed ?? '') as {
			scripts: Record<string, string>;
			devDependencies: Record<string, string>;
		};
		expect(proposed.scripts['test:watch']).toBe('vitest');
		expect(proposed.devDependencies.vitest).toBe('2.1.9');
	});

	it('reports package.json unchanged when everything is already there', () => {
		const pkgCatalog = [
			unit('core-vitest', { packageJsonPatch: { scripts: { test: 'vitest run' } } }),
		];
		writeFileSync(
			join(tmp, 'package.json'),
			`${JSON.stringify({ name: 'x', scripts: { test: 'user harness' } }, null, '\t')}\n`,
		);
		const s = state({
			units: builtinUnits(['core-vitest']),
			files: {},
			attribution: {},
			modes: {},
		});
		// mergeAdditive: an existing script wins, so nothing changes.
		expect(
			planUpdate({ targetDir: tmp, state: s, units: pkgCatalog, pkgRoot: tmp }).pkg.changed,
		).toBe(false);
	});
});

describe('runUpdate on a pre-#117 core-typescript', () => {
	let tmp: string;

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-update-tsflavor-'));
	});

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	it('keeps the DOM libs when no tsFlavor was recorded', async () => {
		const old = '{ "compilerOptions": { "lib": ["ES2022", "DOM", "DOM.Iterable"] } }\n';
		writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'x', version: '0.0.0' }));
		writeFileSync(join(tmp, 'tsconfig.base.json'), old);
		const state: StateFile = {
			_tool: 'x',
			schema: STATE_SCHEMA,
			version: '2.0.0',
			units: builtinUnits(['core-typescript']),
			files: { 'tsconfig.base.json': hashBuffer(Buffer.from(old)) },
			attribution: { 'tsconfig.base.json': 'core-typescript' },
			modes: { 'tsconfig.base.json': 'copy' },
		};
		writeFileSync(join(tmp, '.unbranded.json'), JSON.stringify(state));

		expect(await runUpdate({ cwd: tmp, yes: true, force: true, strategy: 'theirs' })).toBe(0);

		const updated = readFileSync(join(tmp, 'tsconfig.base.json'), 'utf-8');
		expect(updated).toContain('"DOM"');
		expect(updated).toBe(buildTsconfigBase('dom'));
	});
});

describe('runUpdate on a commented .vscode/settings.json (#216)', () => {
	let tmp: string;

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-update-jsonc-'));
	});

	afterEach(() => {
		vi.restoreAllMocks();
		rmSync(tmp, { recursive: true, force: true });
	});

	it('names the file it left alone and does not report everything up to date', async () => {
		const commented = '{\n  // note\n  "editor.tabSize": 4\n}\n';
		mkdirSync(join(tmp, '.vscode'));
		writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'x', version: '0.0.0' }));
		writeFileSync(join(tmp, '.vscode', 'settings.json'), commented);
		const state: StateFile = {
			_tool: 'x',
			schema: STATE_SCHEMA,
			version: '2.0.0',
			units: builtinUnits(['opt-vscode']),
			files: { '.vscode/settings.json': hashBuffer(Buffer.from('{}\n')) },
			attribution: { '.vscode/settings.json': 'opt-vscode' },
			modes: { '.vscode/settings.json': 'merge-json' },
		};
		writeFileSync(join(tmp, '.unbranded.json'), JSON.stringify(state));
		const warn = vi.spyOn(log, 'warn').mockImplementation(() => undefined);
		const out: string[] = [];
		vi.spyOn(process.stdout, 'write').mockImplementation(((m: string) => {
			out.push(String(m));
			return true;
		}) as typeof process.stdout.write);

		expect(await runUpdate({ cwd: tmp, dryRun: true })).toBe(0);

		expect(warn).toHaveBeenCalledWith(expect.stringContaining('.vscode/settings.json as is'));
		const text = out.join('');
		expect(text).toContain('left as is');
		expect(text).not.toMatch(/up-to-date\s+\.vscode/);
		expect(readFileSync(join(tmp, '.vscode', 'settings.json'), 'utf-8')).toBe(commented);
	});
});

describe('runUpdate on an .unbranded.json that does not parse (#231)', () => {
	let tmp: string;
	const BASELINE = '.unbranded/baseline/eslint.config.mjs.base';
	const conflicted = '<<<<<<< HEAD\n{}\n=======\n{}\n>>>>>>> theirs\n';

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-update-malformed-'));
		writeFileSync(join(tmp, '.unbranded.json'), conflicted);
		mkdirSync(join(tmp, '.unbranded', 'baseline'), { recursive: true });
		writeFileSync(join(tmp, BASELINE), 'base\n');
	});

	afterEach(() => {
		vi.restoreAllMocks();
		rmSync(tmp, { recursive: true, force: true });
	});

	it('exits 1 naming the file and leaves it untouched', async () => {
		const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
		expect(await runUpdate({ cwd: tmp, yes: true, strategy: 'theirs' })).toBe(1);
		expect(String(err.mock.calls[0]?.[0])).toContain('.unbranded.json');
		expect(readFileSync(join(tmp, '.unbranded.json'), 'utf-8')).toBe(conflicted);
		expect(existsSync(join(tmp, BASELINE))).toBe(true);
	});
});
