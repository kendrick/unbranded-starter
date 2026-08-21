import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PKG_ROOT } from '../../src/util/paths';

const CLI = join(PKG_ROOT, 'dist/cli.js');

interface StateV2 {
	schema: number;
	units: { id: string; source: { kind: string; path?: string } }[];
	files: Record<string, string>;
	attribution?: Record<string, string>;
	modes?: Record<string, string>;
}

function readState(dir: string): StateV2 {
	return JSON.parse(readFileSync(join(dir, '.unbranded.json'), 'utf-8')) as StateV2;
}

// core-editorconfig (plain copy), opt-vscode (merge-json settings + computed
// extensions.json), and core-node-version (computed .nvmrc) cover every tracked
// file mode, and none of them carries an npm dependency. pm: null in the recipe
// keeps the whole spec install-free.
function run(units: string[], tmp: string): ReturnType<typeof spawnSync<string>> {
	writeFileSync(join(tmp, 'recipe.json'), JSON.stringify({
		units,
		pm: null,
		onConflict: 'overwrite',
		postInstall: 'none',
	}, null, 2));
	return spawnSync('node', [CLI, '--config', 'recipe.json'], { cwd: tmp, encoding: 'utf-8' });
}

describe('state schema v2 (attribution, modes, baseline sidecar)', () => {
	let tmp: string;

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-e2e-state-v2-'));
		writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'state-v2', version: '0.0.0' }, null, 2));
	});

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	it('records who wrote each file and how, and lays down the baseline sidecar', () => {
		const result = run(['core-editorconfig', 'opt-vscode', 'core-node-version'], tmp);
		expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);

		const state = readState(tmp);
		expect(state.schema).toBe(3);

		// Attribution names the writing unit for every kind of write: copy-loop
		// files and the two computed-after-the-loop ones.
		expect(state.attribution?.['.editorconfig']).toBe('core-editorconfig');
		expect(state.attribution?.['.vscode/settings.json']).toBe('opt-vscode');
		expect(state.attribution?.['.vscode/extensions.json']).toBe('opt-vscode');
		expect(state.attribution?.['.nvmrc']).toBe('core-node-version');

		// Modes tell a future `update` which refresh path each file takes.
		expect(state.modes?.['.editorconfig']).toBe('copy');
		expect(state.modes?.['.vscode/settings.json']).toBe('merge-json');
		expect(state.modes?.['.nvmrc']).toBe('computed');

		// Baselines: byte-exact copies for copy-mode files only. Structured and
		// computed files refresh structurally, so a text baseline would mislead.
		expect(readFileSync(join(tmp, '.unbranded', 'baseline', '.editorconfig'), 'utf-8'))
			.toBe(readFileSync(join(tmp, '.editorconfig'), 'utf-8'));
		expect(existsSync(join(tmp, '.unbranded', 'baseline', '.vscode', 'settings.json'))).toBe(false);
		expect(existsSync(join(tmp, '.unbranded', 'baseline', '.nvmrc'))).toBe(false);

		// The sidecar explains itself; a user who stumbles on it learns to commit it.
		const readme = readFileSync(join(tmp, '.unbranded', 'README.md'), 'utf-8');
		expect(readme.toLowerCase()).toContain('commit');

		// diff reads the envelope without complaint and sees no drift.
		const diff = spawnSync('node', [CLI, 'diff'], { cwd: tmp, encoding: 'utf-8' });
		expect(diff.status, diff.stdout).toBe(0);
	});

	it('a second run merges into the tracked history instead of replacing it', () => {
		expect(run(['core-editorconfig'], tmp).status).toBe(0);
		expect(run(['core-gitattributes'], tmp).status).toBe(0);

		const state = readState(tmp);
		// Both runs' units and files survive; remove/update reason over the union.
		expect(state.units.map(u => u.id)).toContain('core-editorconfig');
		expect(state.units.map(u => u.id)).toContain('core-gitattributes');
		expect(state.attribution?.['.editorconfig']).toBe('core-editorconfig');
		expect(state.attribution?.['.gitattributes']).toBe('core-gitattributes');
		expect(existsSync(join(tmp, '.unbranded', 'baseline', '.editorconfig'))).toBe(true);
		expect(existsSync(join(tmp, '.unbranded', 'baseline', '.gitattributes'))).toBe(true);
	});
});

describe('state schema 3 migration boundary', () => {
	let tmp: string;

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-e2e-state-v3-'));
		writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'state-v3', version: '0.0.0' }, null, 2));
	});

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	it('a hand-written schema-2 file (bare-string units) still reads, diffs clean, and removes', () => {
		expect(run(['core-editorconfig'], tmp).status).toBe(0);

		// Schema 1 and 2 could only ever name a built-in, so downgrading `units` to bare
		// ids while leaving files/attribution/modes as the real scaffold wrote them is
		// exactly what a project scaffolded by unbranded 1.x looks like on disk today.
		const scaffolded = readState(tmp);
		writeFileSync(join(tmp, '.unbranded.json'), JSON.stringify({
			...scaffolded,
			schema: 2,
			units: scaffolded.units.map(u => u.id),
		}, null, 2));

		const diff = spawnSync('node', [CLI, 'diff'], { cwd: tmp, encoding: 'utf-8' });
		expect(diff.status, `stdout: ${diff.stdout}\nstderr: ${diff.stderr}`).toBe(0);
		expect(diff.stdout).toContain('No drift.');

		const remove = spawnSync('node', [CLI, 'remove', 'core-editorconfig', '--yes'], { cwd: tmp, encoding: 'utf-8' });
		expect(remove.status, `stdout: ${remove.stdout}\nstderr: ${remove.stderr}`).toBe(0);
		expect(existsSync(join(tmp, '.editorconfig'))).toBe(false);
	});

	it('a state file from a newer unbranded is refused, not read as clean', () => {
		writeFileSync(join(tmp, '.unbranded.json'), JSON.stringify({
			_tool: 'unbranded manages the files below.',
			schema: 99,
			version: '99.0.0',
			units: [],
			files: {},
		}, null, 2));

		// The hazard this gate closes: before it existed, an unreadable state file read
		// as "no state", and diff treats "no state" as an unscaffolded project and exits
		// 0 clean — so a CI drift gate would pass on a repo it couldn't actually read.
		const diff = spawnSync('node', [CLI, 'diff'], { cwd: tmp, encoding: 'utf-8' });
		expect(diff.status, `stdout: ${diff.stdout}\nstderr: ${diff.stderr}`).not.toBe(0);
		expect(diff.stdout).not.toContain('No drift');
		expect(diff.stderr).toContain('newer unbranded');

		const remove = spawnSync('node', [CLI, 'remove', 'core-editorconfig', '--yes'], { cwd: tmp, encoding: 'utf-8' });
		expect(remove.status, `stdout: ${remove.stdout}\nstderr: ${remove.stderr}`).not.toBe(0);
		expect(remove.stderr).toContain('newer unbranded');

		const update = spawnSync('node', [CLI, 'update', '--yes'], { cwd: tmp, encoding: 'utf-8' });
		expect(update.status, `stdout: ${update.stdout}\nstderr: ${update.stderr}`).not.toBe(0);
		expect(update.stderr).toContain('newer unbranded');
	});
});
