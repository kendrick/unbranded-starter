import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PKG_ROOT } from '../../src/util/paths';

const CLI = join(PKG_ROOT, 'dist/cli.js');

function run(args: string[], cwd: string): ReturnType<typeof spawnSync<string>> {
	return spawnSync('node', [CLI, ...args], { cwd, encoding: 'utf-8' });
}

interface StateFile {
	schema: number;
	units: { id: string; source: { kind: string; path?: string } }[];
	files: Record<string, string>;
	attribution?: Record<string, string>;
}

function readState(dir: string): StateFile {
	return JSON.parse(readFileSync(join(dir, '.unbranded.json'), 'utf-8')) as StateFile;
}

function unit(parentDir: string, name: string, definition: unknown, templates: Record<string, string> = {}): string {
	const dir = join(parentDir, name);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, 'unit.json'), JSON.stringify(definition, null, 2));
	for (const [file, body] of Object.entries(templates))
		writeFileSync(join(dir, file), body);
	return dir;
}

const BANNER_CONTENT = 'installed from my-units\n';

const BANNER = {
	schema: 1,
	id: 'banner',
	category: 'foundation',
	label: 'Local banner',
	description: 'Drops a BANNER.txt at the repo root.',
	files: [{ src: 'BANNER.txt', dest: 'BANNER.txt' }],
};

// Implies a sibling (banner) and a built-in (core-editorconfig), so installing
// this one unit exercises both a same-directory reference and a cross-source one.
const STRICT_DOCS = {
	schema: 1,
	id: 'strict-docs',
	category: 'lint',
	label: 'Strict docs',
	description: 'Requires the banner and editorconfig conventions.',
	files: [],
	implies: ['banner', 'core-editorconfig'],
};

function unitsFixture(tmp: string): string {
	const dir = join(tmp, 'my-units');
	unit(dir, 'banner', BANNER, { 'BANNER.txt': BANNER_CONTENT });
	unit(dir, 'strict-docs', STRICT_DOCS);
	return dir;
}

function scaffold(tmp: string, recipe: Record<string, unknown>): ReturnType<typeof spawnSync<string>> {
	writeFileSync(join(tmp, 'recipe.json'), JSON.stringify({
		pm: null,
		onConflict: 'overwrite',
		postInstall: 'none',
		...recipe,
	}, null, 2));
	return run(['--config', 'recipe.json'], tmp);
}

describe('unbranded --units-dir', () => {
	let tmp: string;

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-e2e-units-dir-'));
		writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'units-dir-e2e', version: '0.0.0' }, null, 2));
	});

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	it('scaffolds a local unit and everything it implies, reading templates from its own directory', () => {
		unitsFixture(tmp);
		const result = scaffold(tmp, { unitsDir: './my-units', units: ['my-units/strict-docs'] });
		expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);

		// BANNER.txt isn't a built-in template, so matching bytes here is the proof that
		// the copy resolved `src` against my-units/banner rather than PKG_ROOT.
		expect(readFileSync(join(tmp, 'BANNER.txt'), 'utf-8')).toBe(BANNER_CONTENT);
	});

	it('records a local unit as a project-relative dir source and an implied built-in as a bare id', () => {
		unitsFixture(tmp);
		const result = scaffold(tmp, { unitsDir: './my-units', units: ['my-units/strict-docs'] });
		expect(result.status, result.stderr).toBe(0);

		const state = readState(tmp);
		expect(state.schema).toBe(3);

		const byId = new Map(state.units.map(u => [u.id, u]));
		// Relative, with the leading ./. The state file is committed and read on
		// someone else's machine, where the absolute path this run resolved would name nothing.
		expect(byId.get('my-units/banner')?.source).toEqual({ kind: 'dir', path: './my-units' });
		expect(byId.get('my-units/strict-docs')?.source).toEqual({ kind: 'dir', path: './my-units' });
		// Cross-source implies: strict-docs pulled in its sibling (qualified) and the
		// built-in (still bare; a local unit implying a built-in doesn't relabel it).
		expect(byId.get('core-editorconfig')?.source).toEqual({ kind: 'builtin' });
		expect(state.units.map(u => u.id).sort()).toEqual(['core-editorconfig', 'my-units/banner', 'my-units/strict-docs']);

		expect(state.attribution?.['BANNER.txt']).toBe('my-units/banner');
	});

	it('is clean right after scaffold, then reports drift once the local file is edited', () => {
		unitsFixture(tmp);
		const scaffolded = scaffold(tmp, { unitsDir: './my-units', units: ['my-units/strict-docs'] });
		expect(scaffolded.status, scaffolded.stderr).toBe(0);

		// No --units-dir here: diff has to rediscover the directory from the source.path
		// recorded at scaffold time.
		const clean = run(['diff'], tmp);
		expect(clean.status, clean.stdout).toBe(0);

		writeFileSync(join(tmp, 'BANNER.txt'), 'edited locally\n');
		const dirty = run(['diff'], tmp);
		expect(dirty.status).toBe(1);
		expect(dirty.stdout).toContain('BANNER.txt');
		expect(dirty.stdout).toContain('user-modified');
	});

	it('refuses to strand a dependent, then removes the closure under --cascade', () => {
		unitsFixture(tmp);
		const scaffolded = scaffold(tmp, { unitsDir: './my-units', units: ['my-units/strict-docs'] });
		expect(scaffolded.status, scaffolded.stderr).toBe(0);

		const refused = run(['remove', 'my-units/banner', '--yes'], tmp);
		expect(refused.status).toBe(1);
		expect(refused.stderr).toContain('my-units/strict-docs');
		expect(refused.stderr).toContain('--cascade');
		expect(existsSync(join(tmp, 'BANNER.txt'))).toBe(true);

		const cascaded = run(['remove', 'my-units/banner', '--cascade', '--yes'], tmp);
		expect(cascaded.status, cascaded.stderr).toBe(0);
		expect(existsSync(join(tmp, 'BANNER.txt'))).toBe(false);

		const state = readState(tmp);
		expect(state.units).toEqual([{ id: 'core-editorconfig', source: { kind: 'builtin' } }]);
	});

	it('skips an invalid unit definition, reports it, and still installs the valid ones (AC 5)', () => {
		const dir = unitsFixture(tmp);
		unit(dir, 'broken', {
			schema: 1,
			id: 'broken',
			category: 'nonsense',
			label: 'Broken',
			description: 'Bad category, on purpose.',
			files: [],
		});

		const result = scaffold(tmp, { unitsDir: './my-units', units: ['my-units/strict-docs'] });
		expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
		expect(readFileSync(join(tmp, 'BANNER.txt'), 'utf-8')).toBe(BANNER_CONTENT);

		// runInit narrates through clack, whose log.warn writes to stdout, so the skip
		// report lands there rather than on stderr.
		expect(result.stdout).toContain('Skipped');
		expect(result.stdout).toContain('category: expected');
	});

	it('fails immediately, naming the id, when a recipe names a local unit with no unitsDir set (AC 6)', () => {
		const result = scaffold(tmp, { units: ['my-units/banner'] });
		expect(result.status).toBe(1);
		// The failure surfaces through the same top-level catch as any other config
		// error, so log.error puts it on stdout rather than stderr.
		expect(result.stdout).toContain('my-units/banner');
		expect(result.stdout).toContain('--units-dir');
	});

	it('installs the same way via --units-dir/--units flags, with no recipe file', () => {
		unitsFixture(tmp);
		const result = run(['--units-dir', './my-units', '--units', 'my-units/banner', '--yes'], tmp);
		expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
		expect(readFileSync(join(tmp, 'BANNER.txt'), 'utf-8')).toBe(BANNER_CONTENT);

		const state = readState(tmp);
		const byId = new Map(state.units.map(u => [u.id, u]));
		expect(byId.get('my-units/banner')?.source).toEqual({ kind: 'dir', path: './my-units' });
	});

	it('warns instead of crashing when a day-2 command cannot find the recorded units directory', () => {
		unitsFixture(tmp);
		const scaffolded = scaffold(tmp, { unitsDir: './my-units', units: ['my-units/strict-docs'] });
		expect(scaffolded.status, scaffolded.stderr).toBe(0);

		renameSync(join(tmp, 'my-units'), join(tmp, 'my-units-moved'));

		const result = run(['diff'], tmp);
		expect(result.stderr).toContain('Could not load units');
		// The local units can no longer be judged on the template axis, but
		// core-editorconfig is a built-in (always loadable), so its file is still
		// fully judged and the run reports instead of throwing.
		expect(result.stdout).toContain('.editorconfig');
		expect(result.status).toBe(0);
	});
});
