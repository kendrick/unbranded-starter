import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PKG_ROOT } from '../../src/util/paths';

const CLI = join(PKG_ROOT, 'dist/cli.js');

// The rest of the e2e suite uses pm:null to stay fast, so nothing actually
// spawns a package manager. This one does a real `npm install`, which is the
// only thing that exercises src/install/spawn.ts end to end. It matters most on
// the windows-latest CI leg: there `npm` is an `npm.cmd` shim that bare spawn
// can't exec (EINVAL), so a regression in the shell handling would stop the
// install from ever running.
describe('cli runs a real package-manager install', () => {
	let tmp: string;

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-e2e-install-'));
		writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'install-target', version: '0.0.0' }));
		// core-editorconfig ships files but no dependencies, so the install runs
		// to completion fast and offline while still spawning the PM.
		writeFileSync(join(tmp, 'recipe.json'), JSON.stringify({
			units: ['core-editorconfig'],
			pm: 'npm',
			onConflict: 'overwrite',
			postInstall: 'none',
		}));
	});

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	it('spawns npm and completes the install', () => {
		const result = spawnSync('node', [CLI, '--config', 'recipe.json'], { cwd: tmp, encoding: 'utf-8' });

		expect(result.status, `stderr: ${result.stderr}`).toBe(0);
		// npm writes a lockfile on any successful install. Its presence proves the
		// spawn actually executed rather than failing before it started; a failed
		// spawn is only logged (the run still exits 0), so the lockfile, not the
		// exit code, is what catches a Windows regression here.
		expect(existsSync(join(tmp, 'package-lock.json'))).toBe(true);
	});
});
