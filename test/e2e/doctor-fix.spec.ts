import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PKG_ROOT } from '../../src/util/paths';

const CLI = join(PKG_ROOT, 'dist/cli.js');

function writeJson(path: string, obj: unknown): void {
	writeFileSync(path, JSON.stringify(obj, null, 2));
}

// Exactly three findings, all unit-fixable: no .editorconfig, no .gitattributes,
// no node pin. Everything else in the audit is satisfied, and the three fix-it
// units (core-editorconfig, core-gitattributes, core-node-version) carry zero
// dependencies, so the real `npm install` the apply pipeline runs stays fast.
function fixableRepo(dir: string): void {
	writeJson(join(dir, 'package.json'), {
		name: 'fix-me',
		scripts: { test: 'vitest run', lint: 'eslint .' },
	});
	mkdirSync(join(dir, '.github', 'workflows'), { recursive: true });
	writeFileSync(join(dir, '.github', 'workflows', 'ci.yml'), 'name: ci\n');
}

// A repo whose only finding is manual (coexisting lockfiles): --fix must list it
// and stop, because deleting a lockfile is a human call.
function manualOnlyRepo(dir: string): void {
	writeJson(join(dir, 'package.json'), {
		name: 'manual-only',
		packageManager: 'pnpm@10.0.0',
		engines: { node: '>=22' },
		scripts: { test: 'vitest run', lint: 'eslint .' },
		devDependencies: { typescript: '5.9.3' },
	});
	writeFileSync(join(dir, 'pnpm-lock.yaml'), '');
	writeFileSync(join(dir, 'yarn.lock'), '');
	writeFileSync(join(dir, '.editorconfig'), 'root = true\n');
	writeFileSync(join(dir, '.gitattributes'), '* text=auto\n');
	writeFileSync(join(dir, '.nvmrc'), '22\n');
	writeFileSync(join(dir, 'tsconfig.json'), '{}\n');
	mkdirSync(join(dir, '.github', 'workflows'), { recursive: true });
	writeFileSync(join(dir, '.github', 'workflows', 'ci.yml'), 'name: ci\n');
}

function run(args: string[], cwd: string): ReturnType<typeof spawnSync<string>> {
	return spawnSync('node', [CLI, ...args], { cwd, encoding: 'utf-8' });
}

// One fixable finding (tsconfig-no-ts-dep) against a tsconfig.json the user owns, so
// the apply has exactly one conflict for --on-conflict to decide. Returns the
// user's bytes (#215).
function conflictRepo(dir: string): string {
	writeJson(join(dir, 'package.json'), {
		name: 'x',
		version: '1.0.0',
		scripts: { test: 'vitest', lint: 'eslint .' },
		engines: { node: '>=22' },
	});
	const mine = '{ "compilerOptions": { "strict": false, "MINE": true } }\n';
	writeFileSync(join(dir, 'tsconfig.json'), mine);
	writeFileSync(join(dir, '.editorconfig'), 'root = true\n');
	writeFileSync(join(dir, '.gitattributes'), '* text=auto\n');
	mkdirSync(join(dir, '.github', 'workflows'), { recursive: true });
	writeFileSync(join(dir, '.github', 'workflows', 'ci.yml'), 'on: push\njobs: {}\n');
	return mine;
}

describe('unbranded doctor --fix', () => {
	let tmp: string;

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-e2e-doctor-fix-'));
	});

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	it('repairs a three-finding repo under --yes, and doctor then reports clean', () => {
		fixableRepo(tmp);

		const fix = run(['doctor', '--fix', '--yes', '--pm', 'npm'], tmp);
		expect(fix.status, `stdout: ${fix.stdout}\nstderr: ${fix.stderr}`).toBe(0);

		// The remedies landed and the full pipeline ran (state file included).
		expect(existsSync(join(tmp, '.editorconfig'))).toBe(true);
		expect(existsSync(join(tmp, '.gitattributes'))).toBe(true);
		expect(existsSync(join(tmp, '.nvmrc'))).toBe(true);
		expect(existsSync(join(tmp, '.unbranded.json'))).toBe(true);

		// The loop closes: --strict exits 0 only when the audit is empty.
		const audit = run(['doctor', '--strict'], tmp);
		expect(audit.status, audit.stdout).toBe(0);
	});

	it('previews the repair plan with --dry-run and writes nothing', () => {
		fixableRepo(tmp);

		const fix = run(['doctor', '--fix', '--dry-run', '--yes', '--pm', 'npm'], tmp);
		expect(fix.status, `stderr: ${fix.stderr}`).toBe(0);
		expect(fix.stdout).toContain('would create');

		expect(existsSync(join(tmp, '.editorconfig'))).toBe(false);
		expect(existsSync(join(tmp, '.unbranded.json'))).toBe(false);
		expect(existsSync(join(tmp, 'node_modules'))).toBe(false);
	});

	it('lists a manual-only finding as a step and executes nothing', () => {
		manualOnlyRepo(tmp);

		const fix = run(['doctor', '--fix'], tmp);
		expect(fix.status, `stderr: ${fix.stderr}`).toBe(0);
		expect(fix.stdout).toContain('Manual steps');
		expect(fix.stdout).toContain('lockfile');
		expect(fix.stdout).toContain('nothing for --fix to install');

		// Both lockfiles survive: the remedy is a deletion, and --fix never deletes.
		expect(existsSync(join(tmp, 'pnpm-lock.yaml'))).toBe(true);
		expect(existsSync(join(tmp, 'yarn.lock'))).toBe(true);
		expect(existsSync(join(tmp, '.unbranded.json'))).toBe(false);
	});

	it('rejects --fix --json instead of guessing which output was meant', () => {
		fixableRepo(tmp);

		const fix = run(['doctor', '--fix', '--json'], tmp);
		expect(fix.status).toBe(1);
		expect(fix.stderr).toContain('--json');
		expect(existsSync(join(tmp, '.editorconfig'))).toBe(false);
	});

	it("keeps the user's tsconfig.json under --on-conflict skip (#215)", () => {
		const mine = conflictRepo(tmp);

		const fix = run(['doctor', '--fix', '--yes', '--pm', 'null', '--on-conflict', 'skip'], tmp);
		expect(fix.status, `stdout: ${fix.stdout}\nstderr: ${fix.stderr}`).toBe(0);
		expect(fix.stdout).toContain('0 overwritten');
		expect(fix.stdout).toContain('1 skipped');
		expect(readFileSync(join(tmp, 'tsconfig.json'), 'utf-8')).toBe(mine);
	});

	it('still replaces tsconfig.json under --on-conflict overwrite (#215)', () => {
		conflictRepo(tmp);

		const fix = run(
			['doctor', '--fix', '--yes', '--pm', 'null', '--on-conflict', 'overwrite'],
			tmp,
		);
		expect(fix.status, `stdout: ${fix.stdout}\nstderr: ${fix.stderr}`).toBe(0);
		expect(readFileSync(join(tmp, 'tsconfig.json'), 'utf-8')).toContain(
			'"extends": "./tsconfig.base.json"',
		);
	});

	it('rejects a bad --on-conflict value and writes nothing (#215)', () => {
		const mine = conflictRepo(tmp);

		const fix = run(['doctor', '--fix', '--yes', '--pm', 'null', '--on-conflict', 'bogus'], tmp);
		expect(fix.status).toBe(1);
		expect(fix.stderr + fix.stdout).toContain('config.onConflict must be "overwrite" or "skip".');
		expect(existsSync(join(tmp, '.unbranded.json'))).toBe(false);
		expect(readFileSync(join(tmp, 'tsconfig.json'), 'utf-8')).toBe(mine);
	});
});
