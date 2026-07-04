import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PKG_ROOT } from '../../src/util/paths';

const CLI = join(PKG_ROOT, 'dist/cli.js');
const WARNING = /uncommitted changes/i;

function writeJson(path: string, obj: unknown): void {
	writeFileSync(path, JSON.stringify(obj, null, 2));
}

function initRepo(cwd: string): void {
	execFileSync('git', ['init'], { cwd });
	execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd });
	execFileSync('git', ['config', 'user.name', 'Test'], { cwd });
}

// The guard only fires in augment mode, so every case seeds a package.json.
const RECIPE = {
	units: ['core-editorconfig'],
	pm: null,
	onConflict: 'overwrite',
	postInstall: 'none',
} as const;

describe('dirty-tree guard (config mode)', () => {
	let tmp: string;

	beforeEach(() => {
		tmp = realpathSync(mkdtempSync(join(tmpdir(), 'unbranded-e2e-dirty-')));
	});

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	it('warns but never blocks when the augment repo is dirty', () => {
		// A repo whose only content is an uncommitted package.json is dirty. Config
		// mode has to warn and still finish (exit 0) — if it blocked on a prompt,
		// spawnSync would hang past the test timeout instead of returning cleanly.
		initRepo(tmp);
		writeJson(join(tmp, 'package.json'), { name: 'test-project', version: '0.0.0' });
		writeJson(join(tmp, 'recipe.json'), RECIPE);

		const result = spawnSync('node', [CLI, '--config', 'recipe.json'], { cwd: tmp, encoding: 'utf-8' });

		expect(result.status, `stderr: ${result.stderr}`).toBe(0);
		expect(result.stdout + result.stderr).toMatch(WARNING);
		// The write still happened; the warning is advisory, not a gate.
		expect(existsSync(join(tmp, '.editorconfig'))).toBe(true);
	});

	it('--force suppresses the warning on a dirty repo', () => {
		initRepo(tmp);
		writeJson(join(tmp, 'package.json'), { name: 'test-project', version: '0.0.0' });
		writeJson(join(tmp, 'recipe.json'), RECIPE);

		const result = spawnSync('node', [CLI, '--config', 'recipe.json', '--force'], { cwd: tmp, encoding: 'utf-8' });

		expect(result.status, `stderr: ${result.stderr}`).toBe(0);
		expect(result.stdout + result.stderr).not.toMatch(WARNING);
		expect(existsSync(join(tmp, '.editorconfig'))).toBe(true);
	});

	it('the recipe force field suppresses the warning too', () => {
		initRepo(tmp);
		writeJson(join(tmp, 'package.json'), { name: 'test-project', version: '0.0.0' });
		writeJson(join(tmp, 'recipe.json'), { ...RECIPE, force: true });

		const result = spawnSync('node', [CLI, '--config', 'recipe.json'], { cwd: tmp, encoding: 'utf-8' });

		expect(result.status, `stderr: ${result.stderr}`).toBe(0);
		expect(result.stdout + result.stderr).not.toMatch(WARNING);
	});

	it('a non-git augment directory sees no warning', () => {
		// No `git init`: the .git probe short-circuits before any spawn.
		writeJson(join(tmp, 'package.json'), { name: 'test-project', version: '0.0.0' });
		writeJson(join(tmp, 'recipe.json'), RECIPE);

		const result = spawnSync('node', [CLI, '--config', 'recipe.json'], { cwd: tmp, encoding: 'utf-8' });

		expect(result.status, `stderr: ${result.stderr}`).toBe(0);
		expect(result.stdout + result.stderr).not.toMatch(WARNING);
	});

	it('a clean committed tree sees no warning', () => {
		// The repo lives in a subdir with everything committed; the recipe sits in
		// the parent (untracked, but outside the repo) so the guard reads clean.
		const repo = join(tmp, 'proj');
		mkdirSync(repo);
		initRepo(repo);
		writeJson(join(repo, 'package.json'), { name: 'test-project', version: '0.0.0' });
		execFileSync('git', ['add', '-A'], { cwd: repo });
		execFileSync('git', ['commit', '-m', 'seed'], { cwd: repo });
		writeJson(join(tmp, 'recipe.json'), RECIPE);

		const result = spawnSync('node', [CLI, '--config', 'recipe.json', '--target', 'proj'], { cwd: tmp, encoding: 'utf-8' });

		expect(result.status, `stderr: ${result.stderr}`).toBe(0);
		expect(result.stdout + result.stderr).not.toMatch(WARNING);
	});
});
