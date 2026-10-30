import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { STATE_SCHEMA } from '../../src/state/state';
import { PKG_ROOT } from '../../src/util/paths';

const CLI = join(PKG_ROOT, 'dist/cli.js');

function writeJson(path: string, obj: unknown): void {
	writeFileSync(path, JSON.stringify(obj, null, 2));
}

// Scaffold core-editorconfig (a single plain-copy file, no deps, no install) into
// an augment-mode project so a .unbranded.json lands for `diff` to read.
function scaffold(tmp: string): void {
	writeJson(join(tmp, 'package.json'), { name: 'drift-project', version: '0.0.0' });
	writeJson(join(tmp, 'recipe.json'), {
		units: ['core-editorconfig'],
		pm: null,
		onConflict: 'overwrite',
		postInstall: 'none',
	});
	const applied = spawnSync('node', [CLI, '--config', 'recipe.json'], {
		cwd: tmp,
		encoding: 'utf-8',
	});
	expect(applied.status, `scaffold stderr: ${applied.stderr}`).toBe(0);
}

describe('unbranded diff', () => {
	let tmp: string;

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-e2e-diff-'));
	});

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	it('writes a deterministic, sorted, schema-versioned state file on apply', () => {
		scaffold(tmp);

		const raw = readFileSync(join(tmp, '.unbranded.json'), 'utf-8');
		const state = JSON.parse(raw) as {
			schema: number;
			version: string;
			units: { id: string; source: { kind: string } }[];
			files: Record<string, string>;
		};

		expect(state.schema).toBe(STATE_SCHEMA);
		expect(state.units).toContainEqual({ id: 'core-editorconfig', source: { kind: 'builtin' } });
		// One hash per written file, keys sorted for a clean VCS diff.
		expect(Object.keys(state.files)).toEqual(['.editorconfig']);
		expect(state.files['.editorconfig']).toMatch(/^[0-9a-f]{64}$/);
		// Top-level keys serialize in sorted order (tab-indented, #48); _tool sorts
		// first. attribution and modes arrived in schema 2 (options is omitted here —
		// a core-editorconfig run resolves none).
		expect([...raw.matchAll(/^\t"(\w+)":/gm)].map((m) => m[1])).toEqual([
			'_tool',
			'attribution',
			'files',
			'modes',
			'schema',
			'units',
			'version',
		]);
	});

	it('reports no drift and exits 0 right after a clean scaffold', () => {
		scaffold(tmp);

		const result = spawnSync('node', [CLI, 'diff'], { cwd: tmp, encoding: 'utf-8' });
		expect(result.status, `stderr: ${result.stderr}`).toBe(0);
		expect(result.stdout).toMatch(/unchanged\s+\.editorconfig/);
		expect(result.stdout).toContain('No drift.');
	});

	it('classifies a user edit and exits non-zero so CI catches drift', () => {
		scaffold(tmp);
		writeFileSync(
			join(tmp, '.editorconfig'),
			`${readFileSync(join(tmp, '.editorconfig'), 'utf-8')}\n# my override\n`,
		);

		const result = spawnSync('node', [CLI, 'diff'], { cwd: tmp, encoding: 'utf-8' });
		expect(result.status).toBe(1);
		expect(result.stdout).toMatch(/user-modified\s+\.editorconfig/);
		expect(result.stdout).toContain('Drift detected.');
	});

	it('--diff prints the unified patch for a drifted file', () => {
		scaffold(tmp);
		writeFileSync(
			join(tmp, '.editorconfig'),
			`${readFileSync(join(tmp, '.editorconfig'), 'utf-8')}\n# my override\n`,
		);

		const plain = spawnSync('node', [CLI, 'diff'], { cwd: tmp, encoding: 'utf-8' });
		const withDiff = spawnSync('node', [CLI, 'diff', '--diff'], { cwd: tmp, encoding: 'utf-8' });
		expect(withDiff.status).toBe(1);
		expect(withDiff.stdout).toContain('my override');
		expect(withDiff.stdout.length).toBeGreaterThan(plain.stdout.length);
	});

	it('--json emits a stable machine-readable report and the drift flag', () => {
		scaffold(tmp);
		writeFileSync(
			join(tmp, '.editorconfig'),
			`${readFileSync(join(tmp, '.editorconfig'), 'utf-8')}\n# edit\n`,
		);

		const result = spawnSync('node', [CLI, 'diff', '--json'], { cwd: tmp, encoding: 'utf-8' });
		expect(result.status).toBe(1);
		const parsed = JSON.parse(result.stdout) as {
			drift: boolean;
			files: { path: string; status: string }[];
		};
		expect(parsed.drift).toBe(true);
		expect(parsed.files.find((f) => f.path === '.editorconfig')?.status).toBe('user-modified');
	});

	it('gives a friendly nudge (exit 0) when the project was never tracked', () => {
		// A bare dir with no .unbranded.json must not error or stack-trace.
		const result = spawnSync('node', [CLI, 'diff'], { cwd: tmp, encoding: 'utf-8' });
		expect(result.status, `stderr: ${result.stderr}`).toBe(0);
		expect(result.stdout).toMatch(/Run `unbranded`/);
		expect(existsSync(join(tmp, '.unbranded.json'))).toBe(false);
	});

	it('refuses with stderr only and exit 1 when .unbranded.json does not parse (#231)', () => {
		scaffold(tmp);
		const conflicted = '<<<<<<< HEAD\n{}\n=======\n{}\n>>>>>>> theirs\n';
		writeFileSync(join(tmp, '.unbranded.json'), conflicted);
		const baseline = join(tmp, '.unbranded', 'baseline', '.editorconfig.base');
		expect(existsSync(baseline)).toBe(true);
		for (const args of [['diff'], ['diff', '--json']]) {
			const result = spawnSync('node', [CLI, ...args], { cwd: tmp, encoding: 'utf-8' });
			expect(result.status).toBe(1);
			expect(result.stdout).toBe('');
			expect(result.stderr).toContain('.unbranded.json');
		}
		const update = spawnSync('node', [CLI, 'update', '--yes', '--strategy', 'theirs'], {
			cwd: tmp,
			encoding: 'utf-8',
		});
		expect(update.status).toBe(1);
		expect(update.stderr).toContain('.unbranded.json');
		const remove = spawnSync('node', [CLI, 'remove', 'core-editorconfig', '--yes', '--force'], {
			cwd: tmp,
			encoding: 'utf-8',
		});
		expect(remove.status).toBe(1);
		expect(remove.stderr).toContain("doesn't parse");
		const doctor = spawnSync('node', [CLI, 'doctor', '--json'], { cwd: tmp, encoding: 'utf-8' });
		expect(doctor.stderr).toContain('.unbranded.json');
		expect(() => JSON.parse(doctor.stdout) as unknown).not.toThrow();
		expect(readFileSync(join(tmp, '.unbranded.json'), 'utf-8')).toBe(conflicted);
		expect(existsSync(baseline)).toBe(true);
	});

	it('documents `unbranded diff` distinctly from the --dry-run preview in --help', () => {
		const result = spawnSync('node', [CLI, '--help'], { encoding: 'utf-8' });
		expect(result.status).toBe(0);
		expect(result.stdout).toContain('unbranded diff');
		expect(result.stdout).toMatch(/Compare tracked files against \.unbranded\.json/);
	});
});

// F-00 / issue #25: .nvmrc and .vscode/extensions.json are computed inside
// writeAndInstall, after the copy loop, so they're the files most likely to slip
// out of .unbranded.json. Scaffold both units and prove the recorded map includes
// them and that diff catches a hand edit to a computed file.
describe('unbranded diff — computed writes are tracked (F-00)', () => {
	let tmp: string;

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-e2e-diff-computed-'));
	});

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	// pm:null skips the install spawn, so this stays a pure file-write test: .nvmrc
	// pins from the running node major, extensions.json from the picked units.
	function scaffoldComputed(): void {
		writeJson(join(tmp, 'package.json'), { name: 'computed-writes', version: '0.0.0' });
		writeJson(join(tmp, 'recipe.json'), {
			units: ['core-node-version', 'opt-vscode'],
			pm: null,
			onConflict: 'overwrite',
			postInstall: 'none',
		});
		const applied = spawnSync('node', [CLI, '--config', 'recipe.json'], {
			cwd: tmp,
			encoding: 'utf-8',
		});
		expect(applied.status, `scaffold stderr: ${applied.stderr}`).toBe(0);
	}

	it('records the computed .nvmrc and .vscode/extensions.json in .unbranded.json', () => {
		scaffoldComputed();

		const state = JSON.parse(readFileSync(join(tmp, '.unbranded.json'), 'utf-8')) as {
			files: Record<string, string>;
		};
		// Both computed files land alongside the statically-copied settings.json.
		expect(Object.keys(state.files)).toEqual(
			expect.arrayContaining(['.nvmrc', '.vscode/extensions.json', '.vscode/settings.json']),
		);
		expect(state.files['.nvmrc']).toMatch(/^[0-9a-f]{64}$/);
		expect(state.files['.vscode/extensions.json']).toMatch(/^[0-9a-f]{64}$/);
	});

	it('classifies a hand-edited .nvmrc as user-modified and exits non-zero', () => {
		scaffoldComputed();
		writeFileSync(join(tmp, '.nvmrc'), '18\n');

		const result = spawnSync('node', [CLI, 'diff'], { cwd: tmp, encoding: 'utf-8' });
		expect(result.status, `stderr: ${result.stderr}`).toBe(1);
		expect(result.stdout).toMatch(/user-modified\s+\.nvmrc/);
		expect(result.stdout).toContain('Drift detected.');
	});
});

// #227: a merge-json or append-if-missing file merged into an existing one records
// the merge result, so the raw template's hash never matches it. diff has to judge
// those files by planFileOp's outcome, the rule update uses.
describe('unbranded diff — merge modes into an existing file (#227)', () => {
	let tmp: string;

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-e2e-diff-merge-'));
	});

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	const run = (...args: string[]) =>
		spawnSync('node', [CLI, ...args], { cwd: tmp, encoding: 'utf-8' });

	function scaffoldCfg(): void {
		writeJson(join(tmp, 'package.json'), { name: 't', version: '0.0.0' });
		mkdirSync(join(tmp, 'my-units', 'cfg'), { recursive: true });
		writeJson(join(tmp, 'my-units', 'cfg', 'unit.json'), {
			schema: 1,
			id: 'cfg',
			category: 'foundation',
			label: 'Cfg',
			description: 'Merges and appends.',
			files: [
				{ src: 'cfg.json', dest: 'cfg.json', mode: 'merge-json' },
				{ src: 'ignore.txt', dest: '.prettierignore', mode: 'append-if-missing' },
			],
		});
		writeFileSync(join(tmp, 'my-units', 'cfg', 'cfg.json'), '{"b": 2}\n');
		writeFileSync(join(tmp, 'my-units', 'cfg', 'ignore.txt'), 'dist\n');
		writeFileSync(join(tmp, 'cfg.json'), '{"a": 1}\n');
		writeFileSync(join(tmp, '.prettierignore'), 'coverage\n');
		const applied = run(
			'--units-dir',
			'./my-units',
			'--units',
			'my-units/cfg',
			'--pm',
			'null',
			'--yes',
			'--force',
		);
		expect(applied.status, `scaffold stderr: ${applied.stderr}`).toBe(0);
	}

	// Maps each path both commands list to whether diff and update call it drifted.
	function agreement(): { path: string; diffDrifted: boolean; updateDrifted: boolean }[] {
		const diff = JSON.parse(run('diff', '--json').stdout) as {
			files: { path: string; status: string }[];
		};
		// The dry-run plan is a clack table, one `label  path` row per file; `merge`
		// and `needs choice` are its labels for merged and needs-choice.
		const update = new Map(
			[
				...run('update', '--dry-run').stdout.matchAll(
					/^│\s+(up-to-date|merge|needs choice)\s+(\S+)/gm,
				),
			].map((m) => [m[2], m[1]]),
		);
		// An empty table would make every agreement check vacuous.
		expect(update.size).toBeGreaterThan(0);
		return diff.files.flatMap((f) => {
			const u = update.get(f.path);
			return u === undefined
				? []
				: [
						{
							path: f.path,
							diffDrifted: f.status === 'template-updated' || f.status === 'both',
							updateDrifted: u === 'merge' || u === 'needs choice',
						},
					];
		});
	}

	it('reports no drift right after merging into existing files', () => {
		scaffoldCfg();
		const result = run('diff');
		expect(result.status, `stdout: ${result.stdout}`).toBe(0);
		expect(result.stdout).toContain('No drift.');
		expect(agreement().filter((a) => a.diffDrifted || a.updateDrifted)).toEqual([]);
	});

	it('reports no drift for opt-vscode merged into an existing .vscode/settings.json', () => {
		writeJson(join(tmp, 'package.json'), { name: 't', version: '0.0.0' });
		mkdirSync(join(tmp, '.vscode'));
		writeFileSync(join(tmp, '.vscode', 'settings.json'), '{"editor.tabSize": 4}\n');
		const applied = run('--units', 'opt-vscode', '--pm', 'null', '--yes', '--force');
		expect(applied.status, `scaffold stderr: ${applied.stderr}`).toBe(0);
		const result = run('diff');
		expect(result.status, `stdout: ${result.stdout}`).toBe(0);
		expect(result.stdout).toContain('No drift.');
	});

	it('reports template-updated when the template adds a key, and agrees with update', () => {
		scaffoldCfg();
		writeFileSync(join(tmp, 'my-units', 'cfg', 'cfg.json'), '{"b": 2, "c": 3}\n');
		const result = run('diff');
		expect(result.status).toBe(1);
		expect(result.stdout).toMatch(/template-updated\s+cfg\.json/);
		expect(agreement().find((a) => a.path === 'cfg.json')).toEqual({
			path: 'cfg.json',
			diffDrifted: true,
			updateDrifted: true,
		});
	});

	it('reports user-modified when the user adds a key the template does not set', () => {
		scaffoldCfg();
		writeFileSync(join(tmp, 'cfg.json'), '{"a": 1, "b": 2, "mine": true}\n');
		const result = run('diff');
		expect(result.status).toBe(1);
		expect(result.stdout).toMatch(/user-modified\s+cfg\.json/);
		expect(agreement().find((a) => a.path === 'cfg.json')?.updateDrifted).toBe(false);
	});

	it('reports both for a conflict the user also edited, matching update needs-choice', () => {
		scaffoldCfg();
		writeFileSync(join(tmp, 'my-units', 'cfg', 'cfg.json'), '{"b": 3}\n');
		writeFileSync(join(tmp, 'cfg.json'), '{"a": 1, "b": 2, "mine": true}\n');
		const result = run('diff');
		expect(result.status).toBe(1);
		expect(result.stdout).toMatch(/user\+template\s+cfg\.json/);
		expect(agreement().find((a) => a.path === 'cfg.json')).toEqual({
			path: 'cfg.json',
			diffDrifted: true,
			updateDrifted: true,
		});
	});

	it('reports template-updated when the template adds a line to an appended file', () => {
		scaffoldCfg();
		writeFileSync(join(tmp, 'my-units', 'cfg', 'ignore.txt'), 'dist\nbuild\n');
		const result = run('diff');
		expect(result.status).toBe(1);
		expect(result.stdout).toMatch(/template-updated\s+\.prettierignore/);
		expect(agreement().find((a) => a.path === '.prettierignore')).toEqual({
			path: '.prettierignore',
			diffDrifted: true,
			updateDrifted: true,
		});
	});
});
