import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PKG_ROOT } from '../../src/util/paths';

// The unit boundary #112 reported, driven through a real scaffold run: a
// project selecting Tailwind alone must not receive the PostCSS adapter, since
// a Vite project reaches Tailwind through @tailwindcss/vite and never loads it.
const CLI = join(PKG_ROOT, 'dist/cli.js');

function writeJson(path: string, obj: unknown): void {
	writeFileSync(path, JSON.stringify(obj, null, 2));
}

// pm:null skips install, so a scaffold run is offline and fast. --config skips
// the Apply confirm, so no stdin is needed.
function scaffold(tmp: string, units: string[]): void {
	writeJson(join(tmp, 'package.json'), { name: 'tailwind-postcss', version: '0.0.0' });
	writeJson(join(tmp, 'recipe.json'), { units, pm: null, onConflict: 'overwrite', postInstall: 'none' });
	const result = spawnSync('node', [CLI, '--config', 'recipe.json'], { cwd: tmp, encoding: 'utf-8' });
	expect(result.status, `stderr: ${result.stderr}`).toBe(0);
}

describe('tailwind / postcss unit split (e2e)', () => {
	let tmp: string;

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-e2e-tw-postcss-'));
	});

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	it('core-tailwind alone installs tailwindcss and not the postcss adapter', () => {
		scaffold(tmp, ['core-tailwind']);
		const pkg = JSON.parse(readFileSync(join(tmp, 'package.json'), 'utf-8'));
		// Asserted as an exact key set, not an absence check: a third package
		// arriving here is the same regression wearing a different name.
		expect(Object.keys(pkg.devDependencies)).toEqual(['tailwindcss']);
		expect(existsSync(join(tmp, 'postcss.config.mjs'))).toBe(false);
	});

	it('core-postcss pulls in tailwindcss via implies and ships the config', () => {
		scaffold(tmp, ['core-postcss']);
		expect(existsSync(join(tmp, 'postcss.config.mjs'))).toBe(true);
		const pkg = JSON.parse(readFileSync(join(tmp, 'package.json'), 'utf-8'));
		expect(pkg.devDependencies).toMatchObject({
			'tailwindcss': expect.any(String),
			'@tailwindcss/postcss': expect.any(String),
		});
	});
});
