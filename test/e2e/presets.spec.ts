import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PKG_ROOT } from '../../src/util/paths';

const CLI = join(PKG_ROOT, 'dist/cli.js');

function run(args: string[], cwd: string): ReturnType<typeof spawnSync<string>> {
	return spawnSync('node', [CLI, ...args], { cwd, encoding: 'utf-8' });
}

// The install-free preset behaviors: presets default to pm null, so a bare
// --preset run writes files and state without touching a package manager. The
// real-install workout (scaffold, install, then run the scaffold's own
// scripts) lives in preset-install.spec.ts on its own CI jobs.
describe('unbranded --preset', () => {
	let tmp: string;

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-e2e-preset-'));
		writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'preset-me', version: '0.0.0' }, null, 2));
	});

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	it('scaffolds the cli preset: files land, state records the resolved set', () => {
		const result = run(['--preset', 'cli'], tmp);
		expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);

		expect(existsSync(join(tmp, '.editorconfig'))).toBe(true);
		expect(existsSync(join(tmp, 'eslint.config.mjs'))).toBe(true);
		expect(existsSync(join(tmp, '.github', 'workflows', 'ci.yml'))).toBe(true);
		// cli deliberately omits the git hooks.
		expect(existsSync(join(tmp, 'lint-staged.config.mjs'))).toBe(false);

		const state = JSON.parse(readFileSync(join(tmp, '.unbranded.json'), 'utf-8')) as { units: string[]; options?: Record<string, string> };
		expect(state.units).toContain('core-eslint');
		expect(state.units).not.toContain('opt-husky');
		expect(state.options?.eslintFlavor).toBe('base');
	});

	it('extends a preset with --units instead of replacing it', () => {
		const result = run(['--preset', 'cli', '--units', 'opt-vscode'], tmp);
		expect(result.status, result.stderr).toBe(0);

		const state = JSON.parse(readFileSync(join(tmp, '.unbranded.json'), 'utf-8')) as { units: string[] };
		// Both the preset's set and the addition survive.
		expect(state.units).toContain('core-eslint');
		expect(state.units).toContain('opt-vscode');
	});

	it('composes with --dry-run --json: the plan shows the preset expansion', () => {
		const result = run(['--dry-run', '--json', '--preset', 'next-app', '--pm', 'pnpm'], tmp);
		expect(result.status, result.stderr).toBe(0);
		const plan = JSON.parse(result.stdout) as { pm: string; units: string[]; files: { path: string }[] };
		expect(plan.pm).toBe('pnpm');
		expect(plan.units).toContain('opt-shadcn');
		expect(plan.units).toContain('core-tailwind');
		expect(plan.files.some(f => f.path === 'components.json')).toBe(true);
	});

	it('refuses --preset together with --config', () => {
		writeFileSync(join(tmp, 'recipe.json'), JSON.stringify({ units: ['core-editorconfig'], pm: null, onConflict: 'skip', postInstall: 'none' }));
		const result = run(['--preset', 'cli', '--config', 'recipe.json'], tmp);
		expect(result.status).toBe(1);
		expect(result.stderr).toContain('--preset');
	});

	it('names the shipped presets when given an unknown one', () => {
		const result = run(['--preset', 'vue-app'], tmp);
		expect(result.status).toBe(1);
		expect(`${result.stdout}${result.stderr}`).toContain('node-lib');
	});
});
