import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PKG_ROOT } from '../../src/util/paths';

const CLI = join(PKG_ROOT, 'dist/cli.js');

// --target scaffolds against another directory without cd-ing there first. The
// interesting property is that files land in the target while a relative --config
// path still resolves against the directory the command was invoked from.
describe('cli --target', () => {
	let work: string;

	beforeEach(() => {
		work = mkdtempSync(join(tmpdir(), 'unbranded-e2e-target-'));
		// The recipe lives in the invocation dir and is referenced by a relative
		// path; if --target changed how it resolved, this file wouldn't be found.
		writeFileSync(
			join(work, 'recipe.json'),
			JSON.stringify({
				units: ['core-editorconfig'],
				pm: null,
				onConflict: 'overwrite',
				postInstall: 'none',
			}),
		);
		// An existing package.json makes the target an augment shape, so no name
		// prompt is needed and the run stays non-interactive.
		mkdirSync(join(work, 'app'));
		writeFileSync(
			join(work, 'app', 'package.json'),
			JSON.stringify({ name: 'app', version: '0.0.0' }),
		);
	});

	afterEach(() => {
		rmSync(work, { recursive: true, force: true });
	});

	it('writes into the target dir, not the invocation cwd', () => {
		const result = spawnSync('node', [CLI, '--config', 'recipe.json', '--target', 'app'], {
			cwd: work,
			encoding: 'utf-8',
		});

		expect(result.status, `stderr: ${result.stderr}`).toBe(0);
		// core-editorconfig ships this file into the --target dir, not the cwd.
		expect(existsSync(join(work, 'app', '.editorconfig'))).toBe(true);
		// And nothing should have been scaffolded into the invocation cwd.
		expect(existsSync(join(work, '.editorconfig'))).toBe(false);
	});
});

// A subcommand that drops --target acts on the invocation cwd instead (#223).
// Two scaffolded repos make that visible: change only B, run from A, then check
// both trees.
describe('cli --target on subcommands', () => {
	let base: string;
	let a: string;
	let b: string;

	const git = (cwd: string, ...args: string[]) =>
		spawnSync('git', ['-c', 'user.email=a@b', '-c', 'user.name=x', ...args], {
			cwd,
			encoding: 'utf-8',
		});
	// pnpm sets npm_config_user_agent for the test run, and the CLI would read it as
	// the package manager to use.
	const cli = (cwd: string, ...args: string[]) => {
		const env = { ...process.env };
		delete env.npm_config_user_agent;
		return spawnSync('node', [CLI, ...args], { cwd, encoding: 'utf-8', env, input: '' });
	};

	beforeEach(() => {
		base = mkdtempSync(join(tmpdir(), 'unbranded-e2e-target-sub-'));
		a = join(base, 'A');
		b = join(base, 'B');
		for (const dir of [a, b]) {
			mkdirSync(dir);
			writeFileSync(
				join(dir, 'package.json'),
				JSON.stringify({ name: dir === a ? 'A' : 'B', version: '0.0.0' }),
			);
			git(dir, 'init', '-q');
			const init = cli(dir, '--units', 'core-editorconfig', '--pm', 'null', '--yes');
			expect(init.status, `stderr: ${init.stderr}`).toBe(0);
			git(dir, 'add', '-A');
			git(dir, 'commit', '-qm', 'init');
		}
	});

	afterEach(() => {
		rmSync(base, { recursive: true, force: true });
	});

	it('diff reports the target repo, not the cwd', () => {
		appendFileSync(join(b, '.editorconfig'), '# drift\n');
		const result = cli(a, 'diff', '--target', '../B');

		expect(result.status, `stderr: ${result.stderr}`).toBe(1);
		expect(result.stdout).toMatch(/user-modified\s+\.editorconfig/);
		expect(git(a, 'status', '--short').stdout).toBe('');
	});

	it('remove deletes from the target repo and leaves the cwd repo alone', () => {
		// B stays unmodified: remove keeps a drifted file even with --force.
		const result = cli(a, 'remove', 'core-editorconfig', '--yes', '--target', '../B');

		expect(result.status, `stderr: ${result.stderr}`).toBe(0);
		expect(existsSync(join(b, '.editorconfig'))).toBe(false);
		expect(existsSync(join(a, '.editorconfig'))).toBe(true);
		expect(git(a, 'status', '--short').stdout).toBe('');
	});

	it('update writes only under the target', () => {
		// Update finds nothing to change in a fresh scaffold, so tell the repos apart
		// by tracking: only B still has .unbranded.json. A stale cwd would report
		// "nothing is tracked" instead of reading B.
		rmSync(join(a, '.unbranded.json'));
		const result = cli(a, 'update', '--yes', '--strategy', 'theirs', '--target', '../B');

		expect(result.status, `stderr: ${result.stderr}`).toBe(0);
		expect(result.stdout + result.stderr).not.toContain('nothing is tracked');
		expect(existsSync(join(b, '.unbranded.json'))).toBe(true);
	});

	it('doctor --json audits the target', () => {
		// Only B gets a .gitattributes, so a stale cwd would still report it missing.
		writeFileSync(join(b, '.gitattributes'), '* text=auto\n');
		const result = cli(a, 'doctor', '--json', '--target', '../B');

		expect(result.status, `stderr: ${result.stderr}`).toBe(0);
		expect(result.stdout).not.toContain('missing-gitattributes');
		expect(cli(a, 'doctor', '--json').stdout).toContain('missing-gitattributes');
	});

	it('doctor --fix writes only under the target', () => {
		const result = cli(a, 'doctor', '--fix', '--yes', '--pm', 'null', '--target', '../B');

		expect(result.status, `stderr: ${result.stderr}`).toBe(0);
		expect(git(a, 'status', '--short').stdout).toBe('');
		expect(existsSync(join(b, '.gitattributes'))).toBe(true);
	});
});
