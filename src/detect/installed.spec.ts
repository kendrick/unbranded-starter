import type { Unit, UnitId } from '../manifest/types';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { detectInstalledUnits } from './installed';

function unit(id: UnitId, extras: Partial<Unit> = {}): Unit {
	return { id, category: 'lint', label: id, description: '', files: [], ...extras };
}

function touch(dir: string, rel: string): void {
	const abs = join(dir, rel);
	mkdirSync(dirname(abs), { recursive: true });
	writeFileSync(abs, '');
}

function writeJson(dir: string, name: string, obj: unknown): void {
	writeFileSync(join(dir, name), JSON.stringify(obj));
}

describe('detectInstalledUnits', () => {
	let tmp: string;
	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-installed-'));
	});
	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	it('trusts the state file when present, filtered to the known catalog', () => {
		// The state file records resolved ids from a prior scaffold — auto-added units
		// included — so it wins outright, even without the files on disk.
		writeJson(tmp, '.unbranded.json', {
			_tool: 'x',
			schema: 1,
			version: '0.0.0',
			units: ['core-eslint', 'core-typescript', 'ghost-unit'],
			files: {},
		});
		const units = [unit('core-eslint'), unit('core-typescript'), unit('core-vitest')];
		expect(detectInstalledUnits({ cwd: tmp, units })).toEqual(new Set(['core-eslint', 'core-typescript']));
	});

	it('badges core-tailwind from the tailwindcss dependency (no config file to stat)', () => {
		writeJson(tmp, 'package.json', { devDependencies: { tailwindcss: '4.3.0' } });
		expect(detectInstalledUnits({ cwd: tmp, units: [unit('core-tailwind')] }).has('core-tailwind')).toBe(true);
	});

	it('badges core-node-version from any node pin', () => {
		touch(tmp, '.nvmrc');
		expect(detectInstalledUnits({ cwd: tmp, units: [unit('core-node-version')] }).has('core-node-version')).toBe(true);
	});

	it('badges core-eslint from eslint.config.mjs, since its config lives in a flavor option', () => {
		touch(tmp, 'eslint.config.mjs');
		expect(detectInstalledUnits({ cwd: tmp, units: [unit('core-eslint')] }).has('core-eslint')).toBe(true);
	});

	it('requires every shipped file to be present, not just some', () => {
		const ts = unit('core-typescript', { files: [
			{ src: 'a', dest: 'tsconfig.base.json' },
			{ src: 'b', dest: 'tsconfig.json' },
		] });
		touch(tmp, 'tsconfig.json');
		expect(detectInstalledUnits({ cwd: tmp, units: [ts] }).has('core-typescript')).toBe(false);
		touch(tmp, 'tsconfig.base.json');
		expect(detectInstalledUnits({ cwd: tmp, units: [ts] }).has('core-typescript')).toBe(true);
	});

	it('resolves a renamed file to the path that actually lands', () => {
		const u = unit('core-gitattributes', { files: [
			{ src: 'templates/gitignore', dest: 'gitignore.template', rename: '.gitignore' },
		] });
		touch(tmp, 'gitignore.template');
		expect(detectInstalledUnits({ cwd: tmp, units: [u] }).has('core-gitattributes')).toBe(false);
		touch(tmp, '.gitignore');
		expect(detectInstalledUnits({ cwd: tmp, units: [u] }).has('core-gitattributes')).toBe(true);
	});

	it('badges nothing in a bare repo with no state, deps, or files', () => {
		const units = [unit('core-editorconfig', { files: [{ src: 'x', dest: '.editorconfig' }] }), unit('core-tailwind')];
		expect(detectInstalledUnits({ cwd: tmp, units })).toEqual(new Set());
	});
});
