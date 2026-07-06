import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
	const applied = spawnSync('node', [CLI, '--config', 'recipe.json'], { cwd: tmp, encoding: 'utf-8' });
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
		const state = JSON.parse(raw) as { schema: number; version: string; units: string[]; files: Record<string, string> };

		expect(state.schema).toBe(2);
		expect(state.units).toContain('core-editorconfig');
		// One hash per written file, keys sorted for a clean VCS diff.
		expect(Object.keys(state.files)).toEqual(['.editorconfig']);
		expect(state.files['.editorconfig']).toMatch(/^[0-9a-f]{64}$/);
		// Top-level keys serialize in sorted order (tab-indented, #48); _tool sorts
		// first. Schema 2 adds attribution and modes (options is omitted here — a
		// core-editorconfig run resolves none).
		expect([...raw.matchAll(/^\t"(\w+)":/gm)].map(m => m[1])).toEqual(['_tool', 'attribution', 'files', 'modes', 'schema', 'units', 'version']);
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
		writeFileSync(join(tmp, '.editorconfig'), `${readFileSync(join(tmp, '.editorconfig'), 'utf-8')}\n# my override\n`);

		const result = spawnSync('node', [CLI, 'diff'], { cwd: tmp, encoding: 'utf-8' });
		expect(result.status).toBe(1);
		expect(result.stdout).toMatch(/user-modified\s+\.editorconfig/);
		expect(result.stdout).toContain('Drift detected.');
	});

	it('--diff prints the unified patch for a drifted file', () => {
		scaffold(tmp);
		writeFileSync(join(tmp, '.editorconfig'), `${readFileSync(join(tmp, '.editorconfig'), 'utf-8')}\n# my override\n`);

		const plain = spawnSync('node', [CLI, 'diff'], { cwd: tmp, encoding: 'utf-8' });
		const withDiff = spawnSync('node', [CLI, 'diff', '--diff'], { cwd: tmp, encoding: 'utf-8' });
		expect(withDiff.status).toBe(1);
		expect(withDiff.stdout).toContain('my override');
		expect(withDiff.stdout.length).toBeGreaterThan(plain.stdout.length);
	});

	it('--json emits a stable machine-readable report and the drift flag', () => {
		scaffold(tmp);
		writeFileSync(join(tmp, '.editorconfig'), `${readFileSync(join(tmp, '.editorconfig'), 'utf-8')}\n# edit\n`);

		const result = spawnSync('node', [CLI, 'diff', '--json'], { cwd: tmp, encoding: 'utf-8' });
		expect(result.status).toBe(1);
		const parsed = JSON.parse(result.stdout) as { drift: boolean; files: { path: string; status: string }[] };
		expect(parsed.drift).toBe(true);
		expect(parsed.files.find(f => f.path === '.editorconfig')?.status).toBe('user-modified');
	});

	it('gives a friendly nudge (exit 0) when the project was never tracked', () => {
		// A bare dir with no .unbranded.json must not error or stack-trace.
		const result = spawnSync('node', [CLI, 'diff'], { cwd: tmp, encoding: 'utf-8' });
		expect(result.status, `stderr: ${result.stderr}`).toBe(0);
		expect(result.stdout).toMatch(/Run `unbranded`/);
		expect(existsSync(join(tmp, '.unbranded.json'))).toBe(false);
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
		const applied = spawnSync('node', [CLI, '--config', 'recipe.json'], { cwd: tmp, encoding: 'utf-8' });
		expect(applied.status, `scaffold stderr: ${applied.stderr}`).toBe(0);
	}

	it('records the computed .nvmrc and .vscode/extensions.json in .unbranded.json', () => {
		scaffoldComputed();

		const state = JSON.parse(readFileSync(join(tmp, '.unbranded.json'), 'utf-8')) as { files: Record<string, string> };
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
