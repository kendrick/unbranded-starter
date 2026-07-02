import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PKG_ROOT } from '../../src/util/paths';

const CLI = join(PKG_ROOT, 'dist/cli.js');

function writeJson(path: string, obj: unknown): void {
	writeFileSync(path, JSON.stringify(obj, null, 2));
}

// Every file under `dir`, path plus contents, in a stable order. Comparing the
// snapshot before and after a run is the hard proof that --dry-run touched
// nothing on disk.
function snapshot(dir: string): string {
	return (readdirSync(dir, { recursive: true }) as string[])
		.map(rel => join(dir, rel))
		.filter(p => statSync(p).isFile())
		.sort()
		.map(p => `${relative(dir, p)}\n${readFileSync(p, 'utf-8')}`)
		.join('\n---\n');
}

describe('cli --dry-run (config mode)', () => {
	let tmp: string;

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-e2e-dryrun-'));
	});

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	it('reports a would-plan and writes absolutely nothing', () => {
		writeJson(join(tmp, 'package.json'), { name: 'test-project', version: '0.0.0' });
		// A conflicting eslint config so the plan has a real collision to surface.
		writeFileSync(join(tmp, 'eslint.config.mjs'), '// mine, do not touch\n');
		writeJson(join(tmp, 'recipe.json'), {
			units: ['core-eslint'],
			pm: null,
			onConflict: 'overwrite',
			postInstall: 'none',
		});

		const before = snapshot(tmp);
		const result = spawnSync('node', [CLI, '--config', 'recipe.json', '--dry-run'], {
			cwd: tmp,
			encoding: 'utf-8',
		});
		const after = snapshot(tmp);

		expect(result.status, `stderr: ${result.stderr}`).toBe(0);
		expect(after).toBe(before);
		// package.json must not be seeded/merged, and no install can have run.
		expect(existsSync(join(tmp, 'node_modules'))).toBe(false);
		expect(existsSync(join(tmp, 'tsconfig.base.json'))).toBe(false);
	});

	it('lists the conflict with a path relative to the target dir', () => {
		writeJson(join(tmp, 'package.json'), { name: 'test-project', version: '0.0.0' });
		writeFileSync(join(tmp, 'eslint.config.mjs'), '// mine, do not touch\n');
		writeJson(join(tmp, 'recipe.json'), {
			units: ['core-eslint'],
			pm: null,
			onConflict: 'overwrite',
			postInstall: 'none',
		});

		const result = spawnSync('node', [CLI, '--config', 'recipe.json', '--dry-run'], { cwd: tmp, encoding: 'utf-8' });

		expect(result.status).toBe(0);
		// core-eslint conflicts on eslint.config.mjs; core-typescript (auto) is a
		// clean create. Both should show, and the path is target-relative.
		expect(result.stdout).toMatch(/conflict\s+eslint\.config\.mjs/);
		expect(result.stdout).toMatch(/would create\s+tsconfig\.base\.json/);
		// The plan lists files by their target-relative path, never the absolute one.
		expect(result.stdout).not.toContain(join(tmp, 'eslint.config.mjs'));
	});

	it('summary mirrors the real "Files:" line with would-phrasing', () => {
		writeJson(join(tmp, 'package.json'), { name: 'test-project', version: '0.0.0' });
		writeJson(join(tmp, 'recipe.json'), {
			units: ['core-editorconfig'],
			pm: null,
			onConflict: 'overwrite',
			postInstall: 'none',
		});

		const result = spawnSync('node', [CLI, '--config', 'recipe.json', '--dry-run'], { cwd: tmp, encoding: 'utf-8' });

		expect(result.status).toBe(0);
		// EditorConfig writes .editorconfig + .nvmrc into a bare project: two creates.
		expect(result.stdout).toMatch(/Would: 2 written, 0 merged, 0 appended, 0 skipped, 0 conflicts\./);
	});

	it('reports a conflict regardless of the recipe onConflict (plan is resolution-independent)', () => {
		writeJson(join(tmp, 'package.json'), { name: 'test-project', version: '0.0.0' });
		writeFileSync(join(tmp, 'eslint.config.mjs'), '// mine\n');

		for (const onConflict of ['overwrite', 'skip'] as const) {
			writeJson(join(tmp, 'recipe.json'), { units: ['core-eslint'], pm: null, onConflict, postInstall: 'none' });
			const result = spawnSync('node', [CLI, '--config', 'recipe.json', '--dry-run'], { cwd: tmp, encoding: 'utf-8' });
			expect(result.status, `onConflict=${onConflict}`).toBe(0);
			expect(result.stdout, `onConflict=${onConflict}`).toMatch(/conflict\s+eslint\.config\.mjs/);
		}
		// Still untouched after both runs.
		expect(readFileSync(join(tmp, 'eslint.config.mjs'), 'utf-8')).toBe('// mine\n');
	});

	it('--diff prints a unified patch for conflicts', () => {
		writeJson(join(tmp, 'package.json'), { name: 'test-project', version: '0.0.0' });
		writeFileSync(join(tmp, 'eslint.config.mjs'), '// mine, do not touch\n');
		writeJson(join(tmp, 'recipe.json'), {
			units: ['core-eslint'],
			pm: null,
			onConflict: 'overwrite',
			postInstall: 'none',
		});

		const plain = spawnSync('node', [CLI, '--config', 'recipe.json', '--dry-run'], { cwd: tmp, encoding: 'utf-8' });
		const withDiff = spawnSync('node', [CLI, '--config', 'recipe.json', '--dry-run', '--diff'], { cwd: tmp, encoding: 'utf-8' });

		expect(withDiff.status).toBe(0);
		// createPatch labels the two sides; the diff-only run must carry them.
		expect(withDiff.stdout).toContain('existing');
		expect(withDiff.stdout).toContain('proposed');
		expect(withDiff.stdout.length).toBeGreaterThan(plain.stdout.length);
	});
});

describe('cli --dry-run (interactive mode)', () => {
	let tmp: string;

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-e2e-dryrun-int-'));
	});

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	it('runs the prompt flow, then writes nothing', () => {
		writeJson(join(tmp, 'package.json'), { name: 'test-project', version: '0.0.0' });
		// An empty lockfile lets pm detection resolve pnpm without a select prompt,
		// leaving only the multiselect to drive.
		writeFileSync(join(tmp, 'pnpm-lock.yaml'), '');

		const before = snapshot(tmp);
		// space toggles the first unit (EditorConfig + .nvmrc); carriage return submits.
		const result = spawnSync('node', [CLI, '--dry-run'], { cwd: tmp, encoding: 'utf-8', input: ' \r' });
		const after = snapshot(tmp);

		expect(result.status, `stderr: ${result.stderr}`).toBe(0);
		expect(result.stdout).toContain('would create');
		expect(result.stdout).toContain('Dry run: nothing written.');
		expect(after).toBe(before);
	});
});

describe('cli --help documents the preview flags', () => {
	it('lists --dry-run and --diff', () => {
		const result = spawnSync('node', [CLI, '--help'], { encoding: 'utf-8' });
		expect(result.status).toBe(0);
		expect(result.stdout).toContain('--dry-run');
		expect(result.stdout).toContain('--diff');
	});
});
