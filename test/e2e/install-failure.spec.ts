import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, relative } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { UNITS } from '../../src/manifest/index';
import { PKG_ROOT } from '../../src/util/paths';

const CLI = join(PKG_ROOT, 'dist/cli.js');

// Read the pin from the manifest rather than hardcoding it, so a routine
// pin-bump PR doesn't redden this file (test/e2e/dep-conflict.spec.ts sets
// the same precedent).
const OPT_HUSKY = UNITS.find(u => u.id === 'opt-husky');
const HUSKY_PIN = OPT_HUSKY?.devDependencies?.husky;
if (!HUSKY_PIN)
	throw new Error('opt-husky manifest shape changed—update this test\'s pin lookup.');

// A spec deliberately behind the manifest's pin, so onConflict:'overwrite' has
// a real collision to settle before the install (and rollback) happens.
const CONFLICTING_SPEC = '9.0.0';

function writeJson(path: string, obj: unknown): void {
	writeFileSync(path, JSON.stringify(obj, null, 2));
}

// Copied from test/e2e/dry-run.spec.ts rather than shared, matching how the
// rest of this suite duplicates it.
function snapshot(dir: string): string {
	return (readdirSync(dir, { recursive: true }) as string[])
		.map(rel => join(dir, rel))
		.filter(p => statSync(p).isFile())
		.sort()
		.map(p => `${relative(dir, p)}\n${readFileSync(p, 'utf-8')}`)
		.join('\n---\n');
}

// A fake `npm` that answers the version probe truthfully (writeAndInstall
// queries it before ever spawning the real install) but fails the install
// itself. A fake that failed everything would exercise a spawn-error path
// instead of the "pm ran and exited non-zero" path #114 is actually about.
function writeFakeNpm(binDir: string, installExitCode: number): void {
	mkdirSync(binDir, { recursive: true });

	const sh = join(binDir, 'npm');
	writeFileSync(sh, [
		'#!/bin/sh',
		'if [ "$1" = "--version" ]; then',
		'  echo "10.9.0"',
		'  exit 0',
		'fi',
		`exit ${installExitCode}`,
		'',
	].join('\n'));
	chmodSync(sh, 0o755);

	// CI runs windows-latest, where spawnOptions shells out to let cmd.exe
	// resolve the .cmd shim (src/install/spawn.ts)—without this file the
	// Windows leg would fall through to any real npm still on PATH.
	const cmd = join(binDir, 'npm.cmd');
	writeFileSync(cmd, [
		'@echo off',
		'if "%1"=="--version" (',
		'  echo 10.9.0',
		'  exit /b 0',
		')',
		`exit /b ${installExitCode}`,
		'',
	].join('\r\n'));
}

// Prepend a fake-bin dir onto PATH so node and git stay resolvable—this is
// standing in for a package manager, not the whole environment.
function fakePmEnv(binDir: string): NodeJS.ProcessEnv {
	return { ...process.env, PATH: binDir + delimiter + process.env.PATH };
}

describe('cli install failure and rollback (#114)', () => {
	let tmp: string;
	let proj: string;
	let fakebin: string;

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-e2e-install-failure-'));
		proj = join(tmp, 'proj');
		mkdirSync(proj);
		fakebin = join(tmp, 'fakebin');

		writeJson(join(proj, 'package.json'), {
			name: 'test-project',
			version: '0.0.0',
			devDependencies: { husky: CONFLICTING_SPEC },
		});
		// An unrelated file the run must never touch, so the snapshot equality
		// check has something real to fail on if rollback over- or under-shoots.
		writeFileSync(join(proj, 'README.md'), '# test-project\n');
		writeJson(join(proj, 'recipe.json'), {
			units: ['opt-husky'],
			pm: 'npm',
			onConflict: 'overwrite',
			postInstall: 'none',
		});
	});

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	it('rolls back every write and exits 1 when the install fails', () => {
		writeFakeNpm(fakebin, 2);

		const before = snapshot(proj);
		const result = spawnSync(process.execPath, [CLI, '--config', 'recipe.json'], {
			cwd: proj,
			encoding: 'utf-8',
			env: fakePmEnv(fakebin),
		});

		// The exit code is what a calling script has to go on: without it, a
		// failed install looks identical to a successful one (#114).
		expect(result.status, `stderr: ${result.stderr}`).toBe(1);

		// The hard proof: byte-for-byte back to what stood before the run,
		// husky's files included and README.md never touched.
		expect(snapshot(proj)).toBe(before);
		expect(existsSync(join(proj, '.unbranded.json'))).toBe(false);

		const pkg = JSON.parse(readFileSync(join(proj, 'package.json'), 'utf-8')) as {
			scripts?: Record<string, string>;
			devDependencies: Record<string, string>;
		};
		// `prepare` fires unasked on the next plain install if it survives—the
		// hazard that made #114 expensive rather than cosmetic.
		expect(pkg.scripts?.prepare).toBeUndefined();
		expect(pkg.devDependencies.husky).toBe(CONFLICTING_SPEC);

		const output = result.stdout + result.stderr;
		// unbranded's own failure line, naming the command and the exit code.
		expect(output).toMatch(/npm install/);
		expect(output).toMatch(/exit code 2/);
		// The rollback report, so a user watching the run sees what came back.
		expect(output).toMatch(/Rolled back/);
		expect(output).toMatch(/restored/);
	});

	it('names the lifecycle script the run added to package.json', () => {
		writeFakeNpm(fakebin, 2);

		const result = spawnSync(process.execPath, [CLI, '--config', 'recipe.json'], {
			cwd: proj,
			encoding: 'utf-8',
			env: fakePmEnv(fakebin),
		});

		expect(result.status, `stderr: ${result.stderr}`).toBe(1);

		// clack writes to stdout by default, but that's an implementation detail
		// of the prompt library, not a contract this test should lean on.
		const output = result.stdout + result.stderr;
		expect(output).toMatch(/`prepare`/);
		expect(output).toMatch(/every `npm install` runs it/);
	});

	it('leaves a successful install alone (regression guard)', () => {
		writeFakeNpm(fakebin, 0);

		const result = spawnSync(process.execPath, [CLI, '--config', 'recipe.json'], {
			cwd: proj,
			encoding: 'utf-8',
			env: fakePmEnv(fakebin),
		});

		expect(result.status, `stderr: ${result.stderr}`).toBe(0);
		expect(existsSync(join(proj, '.unbranded.json'))).toBe(true);
		expect(existsSync(join(proj, '.husky', 'pre-commit'))).toBe(true);

		const pkg = JSON.parse(readFileSync(join(proj, 'package.json'), 'utf-8')) as {
			scripts?: Record<string, string>;
			devDependencies: Record<string, string>;
		};
		expect(pkg.scripts?.prepare).toBe('husky');
		expect(pkg.devDependencies.husky).toBe(HUSKY_PIN);
	});
});
