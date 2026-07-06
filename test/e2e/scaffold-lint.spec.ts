import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PKG_ROOT } from '../../src/util/paths';

// #48: a fresh scaffold must lint clean with no fix pass. Unlike eslint-flavors.spec
// (which pre-seeds a package.json, taking the augment path, and lints only the config
// file), this drives the NEW-project seed path: an empty dir with no package.json, so
// the CLI writes it itself, then a real pnpm install so `eslint .` can resolve the
// generated config, then the FULL-project lint.
const CLI = join(PKG_ROOT, 'dist/cli.js');

describe('a fresh core-eslint scaffold passes full-project lint (e2e, real install)', () => {
	let tmp: string;

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-e2e-scaffold-lint-'));
	});

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	it('writes a tab-indented, antfu-ordered package.json that lints clean', () => {
		// No package.json in the dir, so writeAndInstall takes the fresh-seed path.
		// projectName '.' scaffolds in place; pm pnpm runs a real install.
		writeFileSync(join(tmp, 'recipe.json'), JSON.stringify({
			units: ['core-eslint'],
			pm: 'pnpm',
			onConflict: 'overwrite',
			postInstall: 'none',
			projectName: '.',
		}, null, 2));

		const run = spawnSync('node', [CLI, '--config', 'recipe.json'], { cwd: tmp, encoding: 'utf-8' });
		expect(run.status, `scaffold stderr: ${run.stderr}`).toBe(0);

		// Writer-level guards so a failure points at the serializer, not eslint.
		const raw = readFileSync(join(tmp, 'package.json'), 'utf-8');
		expect(raw.includes('\n\t"'), 'package.json should be tab-indented').toBe(true);
		const keys = Object.keys(JSON.parse(raw) as Record<string, unknown>);
		expect(keys.indexOf('type'), 'type should sort before version (antfu order)').toBeLessThan(keys.indexOf('version'));

		// recipe.json is how this test drives the scaffold, not something unbranded
		// writes, so drop it before linting to keep the assertion about product output.
		rmSync(join(tmp, 'recipe.json'));

		// The whole point: full-project `eslint .` with the scaffold's own eslint. node
		// on the JS entry (not the bin shim) stays portable to windows CI; CI=true forces
		// antfu's full ruleset.
		const eslintJs = join(tmp, 'node_modules', 'eslint', 'bin', 'eslint.js');
		const lint = spawnSync('node', [eslintJs, '.'], {
			cwd: tmp,
			encoding: 'utf-8',
			env: { ...process.env, CI: 'true' },
		});
		expect(lint.status, `${lint.stdout}\n${lint.stderr}`).toBe(0);
	});
});
