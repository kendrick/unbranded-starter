import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PKG_ROOT } from '../../src/util/paths';

const CLI = join(PKG_ROOT, 'dist/cli.js');

function writeJson(path: string, obj: unknown): void {
	writeFileSync(path, JSON.stringify(obj, null, 2));
}

describe('cli git init (new-project mode)', () => {
	let tmp: string;

	beforeEach(() => {
		tmp = realpathSync(mkdtempSync(join(tmpdir(), 'unbranded-e2e-git-')));
	});

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	it('git: "init" creates a repo in the new project', () => {
		writeJson(join(tmp, 'recipe.json'), {
			units: ['core-editorconfig'],
			pm: null,
			onConflict: 'overwrite',
			postInstall: 'none',
			projectName: 'fresh',
			git: 'init',
		});

		const result = spawnSync('node', [CLI, '--config', 'recipe.json'], { cwd: tmp, encoding: 'utf-8' });

		expect(result.status, `stderr: ${result.stderr}`).toBe(0);
		expect(existsSync(join(tmp, 'fresh', '.git'))).toBe(true);
	});

	it('runs the husky post-install because git init created the repo first', () => {
		// The load-bearing ordering test: husky's post-install gates on `.git`.
		// A real npm install pulls husky in; only if git init ran before the
		// post-install pass does `husky init` scaffold `.husky/_/`. The plain
		// `.husky/pre-commit` we copy in wouldn't prove that on its own.
		writeJson(join(tmp, 'recipe.json'), {
			units: ['opt-husky'],
			pm: 'npm',
			onConflict: 'overwrite',
			postInstall: 'all',
			projectName: 'hooked',
			git: 'init',
		});

		const result = spawnSync('node', [CLI, '--config', 'recipe.json'], { cwd: tmp, encoding: 'utf-8' });

		expect(result.status, `stderr: ${result.stderr}`).toBe(0);
		const projectDir = join(tmp, 'hooked');
		expect(existsSync(join(projectDir, '.git'))).toBe(true);
		// husky init (post-install) writes this; our file copy never does.
		expect(existsSync(join(projectDir, '.husky', '_', 'husky.sh'))).toBe(true);
		// And the gate reported it ran rather than skipping for a missing repo.
		expect(result.stdout + result.stderr).not.toMatch(/Skipped husky-init/);
	});

	it('warns and continues when the git binary is missing', () => {
		mkdirSync(join(tmp, 'empty-bin'));
		writeJson(join(tmp, 'recipe.json'), {
			units: ['core-editorconfig'],
			pm: null,
			onConflict: 'overwrite',
			postInstall: 'none',
			projectName: 'nogit',
			git: 'init',
		});

		// Invoke node by absolute path so it still launches, but hand the run a
		// PATH with no git on it. The git spawn then fails with ENOENT, which the
		// warn-and-continue path has to swallow rather than crash the scaffold.
		const result = spawnSync(process.execPath, [CLI, '--config', 'recipe.json'], {
			cwd: tmp,
			env: { ...process.env, PATH: join(tmp, 'empty-bin') },
			encoding: 'utf-8',
		});

		expect(result.status, `stderr: ${result.stderr}`).toBe(0);
		expect(result.stdout + result.stderr).toMatch(/is git installed/i);
		// Files still landed; only the repo is missing.
		expect(existsSync(join(tmp, 'nogit', '.editorconfig'))).toBe(true);
		expect(existsSync(join(tmp, 'nogit', '.git'))).toBe(false);
	});

	it('leaves an existing repo alone (no init, no scaffold commit)', () => {
		// Pre-seed a real repo with one commit, then run in-place. A skip means
		// the sentinel stays the tip; a non-skip would stack a scaffold commit on
		// top, which we'd catch. Identity is set so a stray commit could succeed.
		execFileSync('git', ['init'], { cwd: tmp });
		execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: tmp });
		execFileSync('git', ['config', 'user.name', 'Test'], { cwd: tmp });
		writeFileSync(join(tmp, 'seed.txt'), 'seed\n');
		execFileSync('git', ['add', '-A'], { cwd: tmp });
		execFileSync('git', ['commit', '-m', 'sentinel'], { cwd: tmp });

		writeJson(join(tmp, 'recipe.json'), {
			units: ['core-editorconfig'],
			pm: null,
			onConflict: 'overwrite',
			postInstall: 'none',
			projectName: '.',
			git: 'init-commit',
		});

		const result = spawnSync('node', [CLI, '--config', 'recipe.json'], { cwd: tmp, encoding: 'utf-8' });

		expect(result.status, `stderr: ${result.stderr}`).toBe(0);
		const subjects = execFileSync('git', ['log', '--format=%s'], { cwd: tmp, encoding: 'utf-8' }).trim();
		expect(subjects).toBe('sentinel');
	});
});
