import type { Unit } from './types';
import { describe, expect, it } from 'vitest';
import { applyUnitOptions } from './options';

// A fixture unit that mirrors how core-eslint declares a flavor: one option whose
// choices carry the concrete files + devDeps to bake in. Kept local so this tests
// the generic resolver, not the real manifest.
const flavored: Unit = {
	id: 'core-eslint',
	category: 'lint',
	label: 'ESLint',
	description: 'flavored',
	files: [],
	packageJsonPatch: { scripts: { lint: 'eslint .' } },
	implies: ['core-typescript'],
	options: [{
		key: 'eslintFlavor',
		label: 'ESLint flavor',
		default: 'base',
		choices: [
			{ value: 'base', label: 'Base', files: [{ content: 'BASE\n', dest: 'eslint.config.mjs' }], devDependencies: { eslint: '9' } },
			{ value: 'react', label: 'React', files: [{ content: 'REACT\n', dest: 'eslint.config.mjs' }], devDependencies: { 'eslint': '9', 'eslint-plugin-jsx-a11y': '6' } },
		],
	}],
};

describe('applyUnitOptions', () => {
	it('returns a unit without options untouched', () => {
		const plain: Unit = { id: 'core-vitest', category: 'test', label: 'Vitest', description: '', files: [] };
		expect(applyUnitOptions(plain, {})).toEqual(plain);
	});

	it('bakes the selected choice\'s files and devDependencies into a concrete unit', () => {
		const concrete = applyUnitOptions(flavored, { eslintFlavor: 'react' });
		expect(concrete.files).toEqual([{ content: 'REACT\n', dest: 'eslint.config.mjs' }]);
		expect(concrete.devDependencies).toEqual({ 'eslint': '9', 'eslint-plugin-jsx-a11y': '6' });
	});

	it('falls back to the option default when the selection is missing', () => {
		const concrete = applyUnitOptions(flavored, {});
		expect(concrete.files).toEqual([{ content: 'BASE\n', dest: 'eslint.config.mjs' }]);
		expect(concrete.devDependencies).toEqual({ eslint: '9' });
	});

	it('falls back to the default when the selection is an unknown value', () => {
		const concrete = applyUnitOptions(flavored, { eslintFlavor: 'bogus' });
		expect(concrete.files).toEqual([{ content: 'BASE\n', dest: 'eslint.config.mjs' }]);
	});

	it('strips the options field so the rest of the pipeline sees a plain unit', () => {
		const concrete = applyUnitOptions(flavored, { eslintFlavor: 'base' });
		expect(concrete.options).toBeUndefined();
	});

	it('preserves non-varying fields (scripts patch, implies)', () => {
		const concrete = applyUnitOptions(flavored, { eslintFlavor: 'base' });
		expect(concrete.packageJsonPatch).toEqual({ scripts: { lint: 'eslint .' } });
		expect(concrete.implies).toEqual(['core-typescript']);
	});

	it('concatenates choice files onto any static files the unit already declares', () => {
		const withStatic: Unit = {
			...flavored,
			files: [{ src: '.editorconfig', dest: '.editorconfig' }],
		};
		const concrete = applyUnitOptions(withStatic, { eslintFlavor: 'base' });
		expect(concrete.files).toEqual([
			{ src: '.editorconfig', dest: '.editorconfig' },
			{ content: 'BASE\n', dest: 'eslint.config.mjs' },
		]);
	});
});
