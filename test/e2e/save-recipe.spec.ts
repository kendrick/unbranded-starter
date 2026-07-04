import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildRecipe, serializeRecipe } from '../../src/config/recipe';
import { UNITS } from '../../src/manifest/index';
import { resolveSelection } from '../../src/manifest/resolve';
import { PKG_ROOT } from '../../src/util/paths';

const CLI = join(PKG_ROOT, 'dist/cli.js');
const OFFER = /Save this configuration as a recipe/i;

function writeJson(path: string, obj: unknown): void {
	writeFileSync(path, JSON.stringify(obj, null, 2));
}

describe('save-recipe: emitted recipe round-trips through --config', () => {
	let tmp: string;

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-e2e-recipe-'));
	});

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	it('a buildRecipe output, fed back through the CLI, reproduces the resolved plan', () => {
		// Stand in for what a saved interactive run would emit: resolve core-eslint
		// (which implies core-typescript), stamp it with buildRecipe, then hand the
		// file to `--config`. If the recipe is faithful, the CLI re-resolves to the
		// same closed set and writes every unit's files, implied ones included.
		const resolved = resolveSelection(['core-eslint'] as never, UNITS);
		if (resolved.kind !== 'ok')
			throw new Error('fixture did not resolve');
		const recipe = buildRecipe({ ids: resolved.ids, pm: null, latest: false, version: '9.9.9' });

		writeJson(join(tmp, 'package.json'), { name: 'replay-target', version: '0.0.0' });
		writeFileSync(join(tmp, 'recipe.json'), serializeRecipe(recipe));

		// The extra provenance key rides along in the file; the CLI must not choke
		// on it (validate ignores unknown keys).
		expect(readFileSync(join(tmp, 'recipe.json'), 'utf-8')).toContain('"_generatedBy": "unbranded 9.9.9"');

		const result = spawnSync('node', [CLI, '--config', 'recipe.json'], { cwd: tmp, encoding: 'utf-8' });

		expect(result.status, `stderr: ${result.stderr}`).toBe(0);
		// core-eslint's own file plus the implied core-typescript's files.
		expect(existsSync(join(tmp, 'eslint.config.mjs'))).toBe(true);
		expect(existsSync(join(tmp, 'tsconfig.json'))).toBe(true);
		expect(existsSync(join(tmp, 'tsconfig.base.json'))).toBe(true);

		const pkg = JSON.parse(readFileSync(join(tmp, 'package.json'), 'utf-8')) as {
			devDependencies: Record<string, string>;
		};
		expect(pkg.devDependencies.eslint).toBe('9.39.4');
		expect(pkg.devDependencies.typescript).toBe('5.9.3');
	});
});

describe('save-recipe: the offer only appears on a fully interactive run', () => {
	let tmp: string;

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-e2e-recipe-skip-'));
		writeJson(join(tmp, 'package.json'), { name: 'skip-target', version: '0.0.0' });
	});

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	it('config mode never offers to save (and never hangs on the prompt)', () => {
		writeJson(join(tmp, 'recipe.json'), {
			units: ['core-editorconfig'],
			pm: null,
			onConflict: 'overwrite',
			postInstall: 'none',
		});

		const result = spawnSync('node', [CLI, '--config', 'recipe.json'], { cwd: tmp, encoding: 'utf-8' });

		expect(result.status, `stderr: ${result.stderr}`).toBe(0);
		expect(result.stdout + result.stderr).not.toMatch(OFFER);
	});

	it('inline-flag mode never offers to save', () => {
		const result = spawnSync(
			'node',
			[CLI, '--units', 'core-editorconfig', '--pm', 'npm', '--on-conflict', 'overwrite', '--post-install', 'none', '--yes'],
			{ cwd: tmp, encoding: 'utf-8' },
		);

		expect(result.status, `stderr: ${result.stderr}`).toBe(0);
		expect(result.stdout + result.stderr).not.toMatch(OFFER);
	});
});
