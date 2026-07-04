import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PKG_ROOT } from '../../src/util/paths';

const CLI = join(PKG_ROOT, 'dist/cli.js');

function writeJson(path: string, obj: unknown): void {
	writeFileSync(path, JSON.stringify(obj, null, 2));
}

describe('cli inline flags (non-interactive)', () => {
	let tmp: string;

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-e2e-inline-'));
	});

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	it('runs to completion with zero prompts when every field is a flag', () => {
		// Augment mode (pre-seeded package.json) skips the project-name prompt,
		// --pm skips detection, --yes skips the Apply confirm. No stdin is piped,
		// so a lingering prompt would block until the suite timeout and fail here.
		// Neither unit has deps, so the npm install is a no-op and offline.
		writeJson(join(tmp, 'package.json'), { name: 'inline-app', version: '0.0.0' });

		const result = spawnSync(
			'node',
			[CLI, '--units', 'core-editorconfig,core-node-version', '--pm', 'npm', '--on-conflict', 'overwrite', '--post-install', 'none', '--yes'],
			{ cwd: tmp, encoding: 'utf-8' },
		);

		expect(result.status, `stderr: ${result.stderr}`).toBe(0);
		expect(existsSync(join(tmp, '.editorconfig'))).toBe(true);
		// core-node-version computes .nvmrc and the package.json pins from the
		// running toolchain, so a real `npm --version` lands in packageManager.
		expect(existsSync(join(tmp, '.nvmrc'))).toBe(true);
		const pkg = JSON.parse(readFileSync(join(tmp, 'package.json'), 'utf-8'));
		expect(pkg.engines?.node).toMatch(/^>=\d+$/);
		expect(pkg.packageManager).toMatch(/^npm@/);
	});

	it('lets inline --units override the recipe field while inheriting the rest', () => {
		// The recipe selects eslint and skips install (pm:null). The flag swaps
		// the unit set for vitest; pm:null is inherited, so nothing installs.
		writeJson(join(tmp, 'package.json'), { name: 'inline-app', version: '0.0.0' });
		writeJson(join(tmp, 'recipe.json'), {
			units: ['core-eslint'],
			pm: null,
			onConflict: 'overwrite',
			postInstall: 'none',
		});

		const result = spawnSync('node', [CLI, '--config', 'recipe.json', '--units', 'core-vitest'], {
			cwd: tmp,
			encoding: 'utf-8',
		});

		expect(result.status, `stderr: ${result.stderr}`).toBe(0);
		expect(existsSync(join(tmp, 'vitest.config.ts'))).toBe(true); // from the flag
		expect(existsSync(join(tmp, 'eslint.config.mjs'))).toBe(false); // recipe unit replaced
		expect(existsSync(join(tmp, 'node_modules'))).toBe(false); // pm:null inherited from the recipe
	});

	it('rejects --yes with no --units, pointing at --units or --config', () => {
		writeJson(join(tmp, 'package.json'), { name: 'inline-app', version: '0.0.0' });

		const result = spawnSync('node', [CLI, '--yes'], { cwd: tmp, encoding: 'utf-8' });

		expect(result.status).toBe(1);
		expect(result.stderr + result.stdout).toMatch(/--units/);
		expect(result.stderr + result.stdout).toMatch(/--config/);
	});

	it('surfaces recipe-identical validation errors for a bad inline unit', () => {
		writeJson(join(tmp, 'package.json'), { name: 'inline-app', version: '0.0.0' });

		const result = spawnSync('node', [CLI, '--units', 'not-a-real-unit', '--yes'], { cwd: tmp, encoding: 'utf-8' });

		expect(result.status).toBe(1);
		expect(result.stderr + result.stdout).toMatch(/unknown ids: not-a-real-unit/);
	});

	it('rejects a bad --pm with the recipe-style message', () => {
		writeJson(join(tmp, 'package.json'), { name: 'inline-app', version: '0.0.0' });

		const result = spawnSync('node', [CLI, '--units', 'core-editorconfig', '--pm', 'cargo', '--yes'], {
			cwd: tmp,
			encoding: 'utf-8',
		});

		expect(result.status).toBe(1);
		expect(result.stderr + result.stdout).toMatch(/pm must be one of/);
	});

	it('documents each inline flag and its recipe-field equivalent in --help', () => {
		const result = spawnSync('node', [CLI, '--help'], { cwd: tmp, encoding: 'utf-8' });

		expect(result.status).toBe(0);
		expect(result.stdout).toContain('--units');
		expect(result.stdout).toContain('--on-conflict');
		expect(result.stdout).toContain('--post-install');
		expect(result.stdout).toMatch(/recipe field/i);
	});
});
