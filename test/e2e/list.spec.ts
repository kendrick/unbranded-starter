import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PKG_ROOT } from '../../src/util/paths';

const CLI = join(PKG_ROOT, 'dist/cli.js');

interface Catalog {
	schema: number;
	units: { id: string; label: string; files: { dest: string }[] }[];
}

describe('unbranded list', () => {
	let tmp: string;

	beforeEach(() => {
		// An empty temp dir with no package.json proves `list` needs no target.
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-e2e-list-'));
	});

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	it('prints the grouped catalog anywhere, no TTY or target project needed', () => {
		const result = spawnSync('node', [CLI, 'list'], { cwd: tmp, encoding: 'utf-8' });
		expect(result.status, `stderr: ${result.stderr}`).toBe(0);
		expect(result.stdout).toContain('Foundation');
		expect(result.stdout).toContain('core-eslint');
		expect(result.stdout).toMatch(/implies → core-typescript/);
	});

	it('emits stable, versioned JSON with --json and never leaks internal src paths', () => {
		const result = spawnSync('node', [CLI, 'list', '--json'], { cwd: tmp, encoding: 'utf-8' });
		expect(result.status, `stderr: ${result.stderr}`).toBe(0);

		const parsed = JSON.parse(result.stdout) as Catalog;
		expect(parsed.schema).toBe(1);
		expect(parsed.units.length).toBeGreaterThan(0);
		expect(result.stdout).not.toContain('"src"');

		const eslint = parsed.units.find(u => u.id === 'core-eslint');
		expect(eslint?.files).toEqual([{ dest: 'eslint.config.mjs' }]);

		// Byte-for-byte determinism is the whole point of the versioned envelope.
		const again = spawnSync('node', [CLI, 'list', '--json'], { cwd: tmp, encoding: 'utf-8' });
		expect(again.stdout).toBe(result.stdout);
	});

	it('mentions `unbranded list` in --help', () => {
		const result = spawnSync('node', [CLI, '--help'], { cwd: tmp, encoding: 'utf-8' });
		expect(result.status).toBe(0);
		expect(result.stdout).toContain('unbranded list');
	});
});
