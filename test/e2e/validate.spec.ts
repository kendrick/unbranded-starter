import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PKG_ROOT } from '../../src/util/paths';

const CLI = join(PKG_ROOT, 'dist/cli.js');

function run(args: string[], cwd: string): ReturnType<typeof spawnSync<string>> {
	return spawnSync('node', [CLI, ...args], { cwd, encoding: 'utf-8' });
}

const MINIMAL = {
	schema: 1,
	id: 'banner',
	category: 'foundation',
	label: 'Repo banner',
	description: 'Drops a BANNER.txt at the repo root.',
	files: [{ src: 'BANNER.txt', dest: 'BANNER.txt' }],
};

describe('unbranded validate', () => {
	let tmp: string;

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-e2e-validate-'));
	});

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	function unit(name: string, definition: unknown, templates: Record<string, string> = {}): string {
		const dir = join(tmp, name);
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, 'unit.json'), JSON.stringify(definition, null, 2));
		for (const [file, body] of Object.entries(templates))
			writeFileSync(join(dir, file), body);
		return dir;
	}

	it('accepts a valid unit directory', () => {
		const dir = unit('banner', MINIMAL, { 'BANNER.txt': 'hello\n' });
		const result = run(['validate', dir], tmp);
		expect(result.status).toBe(0);
		expect(result.stdout).toContain('1 unit definition ok');
	});

	it('accepts a lone .json file, resolving templates beside it', () => {
		const dir = unit('banner', MINIMAL, { 'BANNER.txt': 'hello\n' });
		const result = run(['validate', join(dir, 'unit.json')], tmp);
		expect(result.status).toBe(0);
	});

	// The whole point of the command: an author gets every problem at once,
	// each naming where it is, what was wanted, and what was there.
	it('reports path, expected, and got for each issue, and accumulates them', () => {
		const dir = unit('broken', {
			...MINIMAL,
			id: 'Broken_Unit',
			category: 'nonsense',
			devDependencies: { prettier: '^3.4.2' },
			files: [{ src: 'BANNER.txt', dest: 'x.txt', mode: 'merge' }],
		}, { 'BANNER.txt': 'hello\n' });

		const result = run(['validate', dir], tmp);
		expect(result.status).toBe(1);
		expect(result.stdout).toContain('id: expected');
		expect(result.stdout).toContain('"Broken_Unit"');
		expect(result.stdout).toContain('category: expected');
		expect(result.stdout).toContain('devDependencies["prettier"]');
		expect(result.stdout).toContain('files[0].mode: expected');
		// Four distinct problems, one run.
		expect(result.stdout).toMatch(/4 issues/);
	});

	it('rejects a newer schema with an upgrade prompt rather than a parse error', () => {
		const dir = unit('future', { ...MINIMAL, schema: 99, files: [] });
		const result = run(['validate', dir], tmp);
		expect(result.status).toBe(1);
		expect(result.stdout).toContain('unit schema 1 through 1');
		expect(result.stdout).toContain('Upgrade to use it.');
	});

	it('reads every child of a units directory and ignores non-unit children', () => {
		unit('one', { ...MINIMAL, id: 'one', files: [] });
		unit('two', { ...MINIMAL, id: 'two', files: [] });
		mkdirSync(join(tmp, 'not-a-unit'), { recursive: true });
		writeFileSync(join(tmp, 'not-a-unit', 'README.md'), '# nope\n');

		const result = run(['validate', tmp], tmp);
		expect(result.status).toBe(0);
		expect(result.stdout).toContain('2 unit definitions ok');
	});

	// A sibling satisfies a relation that would fail if the unit stood alone,
	// which is why the whole set is parsed before any of it is validated.
	it('resolves relations against siblings in the same directory', () => {
		unit('one', { ...MINIMAL, id: 'one', files: [], implies: ['two'] });
		unit('two', { ...MINIMAL, id: 'two', files: [] });
		expect(run(['validate', tmp], tmp).status).toBe(0);

		rmSync(join(tmp, 'two'), { recursive: true, force: true });
		const alone = run(['validate', tmp], tmp);
		expect(alone.status).toBe(1);
		expect(alone.stdout).toContain('implies[0]');
	});

	it('refuses a unit that takes a built-in id', () => {
		unit('shadow', { ...MINIMAL, id: 'core-eslint', files: [] });
		const result = run(['validate', tmp], tmp);
		expect(result.status).toBe(1);
		expect(result.stdout).toContain('built-in');
	});

	it('refuses two units sharing an id', () => {
		unit('a', { ...MINIMAL, id: 'twin', files: [] });
		unit('b', { ...MINIMAL, id: 'twin', files: [] });
		const result = run(['validate', tmp], tmp);
		expect(result.status).toBe(1);
		expect(result.stdout).toContain('unique');
	});

	it('reports malformed JSON without crashing the run', () => {
		const dir = join(tmp, 'bad-json');
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, 'unit.json'), '{ not json');
		unit('fine', { ...MINIMAL, id: 'fine', files: [] });

		const result = run(['validate', tmp], tmp);
		expect(result.status).toBe(1);
		expect(result.stdout).toContain('valid JSON');
		// The healthy sibling is still read; one bad file doesn't abort the pass.
		expect(result.stdout).toContain('of 2 unit definitions');
	});

	it('errors on a missing path and on a directory holding no units', () => {
		const missing = run(['validate', join(tmp, 'nope.json')], tmp);
		expect(missing.status).toBe(1);
		expect(missing.stderr).toContain('no such file or directory');

		mkdirSync(join(tmp, 'empty'), { recursive: true });
		const empty = run(['validate', join(tmp, 'empty')], tmp);
		expect(empty.status).toBe(1);
		expect(empty.stderr).toContain('unit.json');
	});

	it('requires a path argument', () => {
		const result = run(['validate'], tmp);
		expect(result.status).toBe(1);
		expect(result.stderr).toContain('Usage: unbranded validate <path>');
	});

	it('writes nothing to the directory it reads', () => {
		const dir = unit('banner', MINIMAL, { 'BANNER.txt': 'hello\n' });
		run(['validate', dir], tmp);
		expect(readdirSync(dir).sort()).toEqual(['BANNER.txt', 'unit.json']);
	});
});
