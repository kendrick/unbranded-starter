import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PKG_ROOT } from '../../src/util/paths';

const CLI = join(PKG_ROOT, 'dist/cli.js');

function writeJson(path: string, obj: unknown): void {
	writeFileSync(path, JSON.stringify(obj, null, 2));
}

describe('cli new-project next steps', () => {
	let tmp: string;

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-e2e-greenfield-'));
	});

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	it('does not tell the user to `npm init` once a package.json has been seeded', () => {
		// pm:null skips install, but writeAndInstall still seeds a package.json.
		// The old next-steps text told the user to `npm init` a directory that
		// already had one — that guidance must be gone.
		writeJson(join(tmp, 'recipe.json'), {
			units: ['core-eslint'],
			pm: null,
			onConflict: 'overwrite',
			postInstall: 'none',
			projectName: 'fresh',
		});

		const result = spawnSync('node', [CLI, '--config', 'recipe.json'], {
			cwd: tmp,
			encoding: 'utf-8',
		});

		expect(result.status, `stderr: ${result.stderr}`).toBe(0);

		const projectDir = join(tmp, 'fresh');
		expect(existsSync(join(projectDir, 'package.json'))).toBe(true);

		const output = result.stdout + result.stderr;
		expect(output).not.toMatch(/npm init/);
	});
});

describe('cli in-place / existing-directory scaffolding', () => {
	let tmp: string;

	beforeEach(() => {
		// realpath so basename(cwd) comparisons hold on macOS, where tmpdir is a
		// symlink (/var -> /private/var) that the CLI resolves via process.cwd().
		tmp = realpathSync(mkdtempSync(join(tmpdir(), 'unbranded-e2e-inplace-')));
	});

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	it('projectName "." scaffolds into the current directory, not a subdir', () => {
		writeJson(join(tmp, 'recipe.json'), {
			units: ['core-eslint'],
			pm: null,
			onConflict: 'overwrite',
			postInstall: 'none',
			projectName: '.',
		});

		const result = spawnSync('node', [CLI, '--config', 'recipe.json'], { cwd: tmp, encoding: 'utf-8' });

		expect(result.status, `stderr: ${result.stderr}`).toBe(0);
		// Files land directly in cwd — no mkdir, no chdir into a nested dir.
		expect(existsSync(join(tmp, 'eslint.config.mjs'))).toBe(true);
		// The seeded name defaults to the current directory's basename.
		const pkg = JSON.parse(readFileSync(join(tmp, 'package.json'), 'utf-8')) as { name: string };
		expect(pkg.name).toBe(basename(tmp));
	});

	it('scaffolds into a clone-shaped named directory (.git + README) in config mode', () => {
		mkdirSync(join(tmp, 'cloned', '.git'), { recursive: true });
		writeFileSync(join(tmp, 'cloned', 'README.md'), '# cloned\n');
		writeJson(join(tmp, 'recipe.json'), {
			units: ['core-eslint'],
			pm: null,
			onConflict: 'overwrite',
			postInstall: 'none',
			projectName: 'cloned',
		});

		const result = spawnSync('node', [CLI, '--config', 'recipe.json'], { cwd: tmp, encoding: 'utf-8' });

		expect(result.status, `stderr: ${result.stderr}`).toBe(0);
		expect(existsSync(join(tmp, 'cloned', 'eslint.config.mjs'))).toBe(true);
	});

	it('hard-refuses a named directory holding non-safe files', () => {
		mkdirSync(join(tmp, 'realproj'));
		writeFileSync(join(tmp, 'realproj', 'main.py'), 'print()\n');
		writeJson(join(tmp, 'recipe.json'), {
			units: ['core-eslint'],
			pm: null,
			onConflict: 'overwrite',
			postInstall: 'none',
			projectName: 'realproj',
		});

		const result = spawnSync('node', [CLI, '--config', 'recipe.json'], { cwd: tmp, encoding: 'utf-8' });

		expect(result.status).toBe(1);
		expect(result.stdout + result.stderr).toMatch(/already exists/);
		// The existing file survives untouched — never-clobber held.
		expect(existsSync(join(tmp, 'realproj', 'eslint.config.mjs'))).toBe(false);
	});
});
