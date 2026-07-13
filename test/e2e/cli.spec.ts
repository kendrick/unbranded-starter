import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eslintDevDependencies } from '../../src/manifest/eslint-config';
import { UNITS } from '../../src/manifest/index';
import { PKG_ROOT } from '../../src/util/paths';

const CLI = join(PKG_ROOT, 'dist/cli.js');
// Read the pinned versions from the manifest, not literals, so the weekly pin-bump
// PRs don't redden these tests every time a pin moves.
const ESLINT_PIN = eslintDevDependencies('base').eslint;
const TYPESCRIPT_PIN = UNITS.find(u => u.id === 'core-typescript')?.devDependencies?.typescript;

function writeJson(path: string, obj: unknown): void {
	writeFileSync(path, JSON.stringify(obj, null, 2));
}

describe('cli --config (augment mode)', () => {
	let tmp: string;

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-e2e-cli-'));
	});

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	it('applies core-eslint with pm:null (no install) — fast happy path', () => {
		// Augment mode: pre-seed a package.json so detectTarget picks "augment".
		writeJson(join(tmp, 'package.json'), { name: 'test-project', version: '0.0.0' });
		writeJson(join(tmp, 'recipe.json'), {
			units: ['core-eslint'],
			pm: null,
			onConflict: 'overwrite',
			postInstall: 'none',
		});

		const result = spawnSync('node', [CLI, '--config', 'recipe.json'], {
			cwd: tmp,
			encoding: 'utf-8',
		});

		expect(result.status, `stderr: ${result.stderr}`).toBe(0);

		// File copied from PKG_ROOT.
		expect(existsSync(join(tmp, 'eslint.config.mjs'))).toBe(true);

		// package.json merged with the manifest's pinned deps and scripts.
		const pkg = JSON.parse(readFileSync(join(tmp, 'package.json'), 'utf-8')) as {
			devDependencies: Record<string, string>;
			scripts: Record<string, string>;
		};
		expect(pkg.devDependencies).toMatchObject({ eslint: ESLINT_PIN });
		expect(pkg.scripts).toMatchObject({ lint: 'eslint .' });

		// pm:null means we should NOT have installed (no node_modules, no lockfile).
		expect(existsSync(join(tmp, 'node_modules'))).toBe(false);
	});

	it('implies cascade pulls in core-typescript when core-eslint is selected', () => {
		writeJson(join(tmp, 'package.json'), { name: 'test-project', version: '0.0.0' });
		writeJson(join(tmp, 'recipe.json'), {
			units: ['core-eslint'],
			pm: null,
			onConflict: 'overwrite',
			postInstall: 'none',
		});

		spawnSync('node', [CLI, '--config', 'recipe.json'], { cwd: tmp, encoding: 'utf-8' });

		// core-typescript writes tsconfig.base.json + tsconfig.json, even though
		// only core-eslint was in the recipe.
		expect(existsSync(join(tmp, 'tsconfig.base.json'))).toBe(true);
		expect(existsSync(join(tmp, 'tsconfig.json'))).toBe(true);

		const pkg = JSON.parse(readFileSync(join(tmp, 'package.json'), 'utf-8')) as {
			devDependencies: Record<string, string>;
			scripts: Record<string, string>;
		};
		expect(pkg.devDependencies.typescript).toBe(TYPESCRIPT_PIN);
		expect(pkg.scripts.typecheck).toBe('tsc --noEmit');
	});

	it('skips on conflict when onConflict: "skip"', () => {
		writeJson(join(tmp, 'package.json'), { name: 'test-project', version: '0.0.0' });
		writeFileSync(join(tmp, 'eslint.config.mjs'), '// user content — should not be clobbered\n');
		writeJson(join(tmp, 'recipe.json'), {
			units: ['core-eslint'],
			pm: null,
			onConflict: 'skip',
			postInstall: 'none',
		});

		const result = spawnSync('node', [CLI, '--config', 'recipe.json'], {
			cwd: tmp,
			encoding: 'utf-8',
		});

		expect(result.status).toBe(0);
		expect(readFileSync(join(tmp, 'eslint.config.mjs'), 'utf-8')).toBe('// user content — should not be clobbered\n');
	});

	it('fails fast with a clear error on a bad recipe', () => {
		writeJson(join(tmp, 'package.json'), { name: 'test-project', version: '0.0.0' });
		writeJson(join(tmp, 'recipe.json'), {
			units: ['not-a-real-unit'],
			pm: null,
			onConflict: 'overwrite',
			postInstall: 'none',
		});

		const result = spawnSync('node', [CLI, '--config', 'recipe.json'], {
			cwd: tmp,
			encoding: 'utf-8',
		});

		expect(result.status).toBe(1);
		// Error surfaced via clack's log.error formatting; we just check the substring.
		expect(result.stderr + result.stdout).toMatch(/unknown ids: not-a-real-unit/);
	});
});

describe('cli --config (no package.json, pm:null)', () => {
	let tmp: string;

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-e2e-nopkg-'));
	});

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	it('writes files into a new-project directory and skips install', () => {
		// projectName is required when there's no package.json in cwd.
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

		// detectTarget creates and chdirs into the new project dir.
		const projectDir = join(tmp, 'fresh');
		expect(existsSync(projectDir)).toBe(true);
		expect(existsSync(join(projectDir, 'eslint.config.mjs'))).toBe(true);

		// A minimal package.json was seeded for the merge.
		const pkg = JSON.parse(readFileSync(join(projectDir, 'package.json'), 'utf-8')) as {
			name: string;
			devDependencies: Record<string, string>;
		};
		expect(pkg.name).toBe('fresh');
		expect(pkg.devDependencies.eslint).toBe(ESLINT_PIN);
	});
});

describe('cli version policy (--latest / recipe versions)', () => {
	let tmp: string;

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-e2e-latest-'));
		writeJson(join(tmp, 'package.json'), { name: 'test-project', version: '0.0.0' });
	});

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	function eslintSpec(): string {
		const pkg = JSON.parse(readFileSync(join(tmp, 'package.json'), 'utf-8')) as {
			devDependencies: Record<string, string>;
		};
		return pkg.devDependencies.eslint;
	}

	it('the --latest flag rewrites deps to the latest tag', () => {
		writeJson(join(tmp, 'recipe.json'), {
			units: ['core-eslint'],
			pm: null,
			onConflict: 'overwrite',
			postInstall: 'none',
		});

		const result = spawnSync('node', [CLI, '--config', 'recipe.json', '--latest'], {
			cwd: tmp,
			encoding: 'utf-8',
		});

		expect(result.status, `stderr: ${result.stderr}`).toBe(0);
		expect(eslintSpec()).toBe('latest');
		// The plan note advertises the active policy before writing.
		expect(result.stdout).toMatch(/latest/);
	});

	it('recipe versions: "latest" does the same without the flag', () => {
		writeJson(join(tmp, 'recipe.json'), {
			units: ['core-eslint'],
			pm: null,
			onConflict: 'overwrite',
			postInstall: 'none',
			versions: 'latest',
		});

		const result = spawnSync('node', [CLI, '--config', 'recipe.json'], { cwd: tmp, encoding: 'utf-8' });

		expect(result.status, `stderr: ${result.stderr}`).toBe(0);
		expect(eslintSpec()).toBe('latest');
	});

	it('defaults to the manifest pins', () => {
		writeJson(join(tmp, 'recipe.json'), {
			units: ['core-eslint'],
			pm: null,
			onConflict: 'overwrite',
			postInstall: 'none',
		});

		spawnSync('node', [CLI, '--config', 'recipe.json'], { cwd: tmp, encoding: 'utf-8' });
		expect(eslintSpec()).toBe(ESLINT_PIN);
	});
});
