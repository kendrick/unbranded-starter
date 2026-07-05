import type { Unit, UnitId } from '../../manifest/types';
import { describe, expect, it } from 'vitest';
import { buildUnitPickerOptions } from './options';

function unit(id: UnitId, extras: Partial<Unit> = {}): Unit {
	return { id, category: 'lint', label: id, description: '', files: [], ...extras };
}

describe('buildUnitPickerOptions', () => {
	it('orders by category, not declaration order', () => {
		// Declared monorepo-first, but foundation must sort ahead of it.
		const units = [
			unit('opt-monorepo', { category: 'monorepo', label: 'Monorepo' }),
			unit('core-editorconfig', { category: 'foundation', label: 'EditorConfig' }),
		];
		const options = buildUnitPickerOptions(units, new Set());
		expect(options.map(o => o.value)).toEqual(['core-editorconfig', 'opt-monorepo']);
		expect(options.map(o => o.group)).toEqual(['Foundation', 'Monorepo']);
	});

	it('threads the installed flag through from the given set', () => {
		const units = [unit('core-eslint'), unit('core-vitest')];
		const options = buildUnitPickerOptions(units, new Set<UnitId>(['core-eslint']));
		expect(options.find(o => o.value === 'core-eslint')?.installed).toBe(true);
		expect(options.find(o => o.value === 'core-vitest')?.installed).toBe(false);
	});

	it('builds a detail block: files via effectiveDest, deps, implied labels, postInstall prompts', () => {
		const units = [
			unit('core-typescript', { category: 'types', label: 'TypeScript' }),
			unit('opt-husky', {
				category: 'git',
				label: 'Husky',
				files: [
					{ src: 'x', dest: 'templates/pre-commit', rename: 'pre-commit' },
					{ src: 'y', dest: 'lint-staged.config.mjs', mode: 'copy' },
				],
				devDependencies: { husky: '9.1.7' },
				implies: ['core-typescript'],
				postInstall: [{ id: 'husky-init', command: ['husky', 'init'], prompt: 'Run husky init?', default: true }],
			}),
		];
		const husky = buildUnitPickerOptions(units, new Set()).find(o => o.value === 'opt-husky');
		expect(husky?.detail.files).toEqual([
			{ dest: 'templates/pre-commit', mode: undefined },
			{ dest: 'lint-staged.config.mjs', mode: 'copy' },
		]);
		expect(husky?.detail.devDependencies).toEqual({ husky: '9.1.7' });
		// implies renders as the target's human label, not its raw id.
		expect(husky?.detail.implies).toEqual(['TypeScript']);
		expect(husky?.detail.postInstall).toEqual(['Run husky init?']);
	});

	it('carries a unit\'s options and notes that its files/deps vary by them', () => {
		// core-eslint ships no static files/deps — they live in the flavor choices —
		// so the detail must say so rather than render an empty block.
		const units = [
			unit('core-eslint', {
				label: 'ESLint',
				files: [],
				options: [{ key: 'eslintFlavor', label: 'ESLint flavor', default: 'base', choices: [
					{ value: 'base', label: 'Base' },
					{ value: 'react', label: 'React' },
				] }],
			}),
		];
		const eslint = buildUnitPickerOptions(units, new Set())[0];
		expect(eslint?.options?.[0]?.key).toBe('eslintFlavor');
		expect(eslint?.detail.optionNote).toBeTruthy();
		expect(eslint?.detail.optionNote).toContain('ESLint flavor');
	});

	it('leaves optionNote undefined for a plain unit', () => {
		const opt = buildUnitPickerOptions([unit('core-vitest', { label: 'Vitest' })], new Set())[0];
		expect(opt?.detail.optionNote).toBeUndefined();
		expect(opt?.options).toBeUndefined();
	});
});
