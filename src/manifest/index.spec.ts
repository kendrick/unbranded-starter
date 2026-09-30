import { describe, expect, it } from 'vitest';
import { PKG_ROOT } from '../util/paths';
import { UNITS } from './index';
import { resolveSelection } from './resolve';
import { UNIT_SCHEMA, validateUnitDefinition } from './validate-unit';

describe('manifest', () => {
	it('unitId values are unique across the manifest', () => {
		const ids = UNITS.map(u => u.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	// The built-in catalog is the published contract's first consumer, so it goes
	// through the same validator an authored unit does rather than through a
	// second set of hand-written assertions that could drift from it. This one
	// check subsumes what used to be three: src files resolving on disk, exactly
	// one of src/content per FileOp, and relations naming units that exist.
	//
	// baseDir is PKG_ROOT because that is where a built-in's `src` resolves from.
	// The published semantic is "relative to the unit's own directory"; for the
	// catalog that ships inside the package, that directory is the package root.
	it('every built-in unit satisfies the published unit schema', () => {
		const knownIds = new Set(UNITS.map(u => u.id));
		for (const unit of UNITS) {
			const result = validateUnitDefinition({ schema: UNIT_SCHEMA, ...unit }, { baseDir: PKG_ROOT, knownIds });
			expect(result.ok ? [] : result.issues, `${unit.id} failed validation`).toEqual([]);
		}
	});

	it('core-eslint declares an eslintFlavor option with base/react/next choices', () => {
		const eslint = UNITS.find(u => u.id === 'core-eslint');
		const option = eslint?.options?.find(o => o.key === 'eslintFlavor');
		expect(option).toBeDefined();
		expect(option?.choices.map(c => c.value)).toEqual(['base', 'react', 'next']);
		expect(option?.default).toBe('base');

		// Each choice generates eslint.config.mjs as inline content and brings its
		// own devDeps; base must stay clear of React-ecosystem packages.
		for (const choice of option?.choices ?? []) {
			expect(choice.files?.[0]).toMatchObject({ dest: 'eslint.config.mjs' });
			expect(choice.files?.[0]?.content).toContain('export default antfu(');
			expect(choice.devDependencies).toHaveProperty('@antfu/eslint-config');
		}
		const base = option?.choices.find(c => c.value === 'base');
		expect(base?.devDependencies).not.toHaveProperty('@eslint-react/eslint-plugin');
		expect(base?.devDependencies).not.toHaveProperty('@next/eslint-plugin-next');
	});

	it('core-oxlint declares an oxlintFlavor option whose choices write both oxc configs (#157)', () => {
		const oxlint = UNITS.find(u => u.id === 'core-oxlint');
		expect(oxlint?.category).toBe('lint');
		expect(oxlint?.files).toEqual([]);
		expect(oxlint?.devDependencies).toEqual({ oxlint: '1.86.0', oxfmt: '0.71.0' });
		expect(oxlint?.implies).toEqual(['core-typescript']);
		expect(oxlint?.excludes).toEqual(['core-eslint']);
		expect(oxlint?.recommendedExtensions).toEqual(['oxc.oxc-vscode']);
		expect(oxlint?.packageJsonPatch?.scripts).toEqual({
			'lint': 'oxlint --no-error-on-unmatched-pattern',
			'lint:fix': 'oxlint --no-error-on-unmatched-pattern --fix',
			'format': 'oxfmt',
		});

		const option = oxlint?.options?.find(o => o.key === 'oxlintFlavor');
		expect(option?.default).toBe('base');
		expect(option?.choices.map(c => c.value)).toEqual(['base', 'react', 'next']);
		for (const choice of option?.choices ?? [])
			expect(choice.files?.map(f => f.dest)).toEqual(['.oxlintrc.json', '.oxfmtrc.json']);
	});

	it('refuses core-oxlint alongside core-eslint (#157)', () => {
		const result = resolveSelection(['core-oxlint', 'core-eslint'], UNITS);
		expect(result.kind).toBe('conflict');
		if (result.kind === 'conflict')
			expect([...result.pair].sort()).toEqual(['core-eslint', 'core-oxlint']);
	});

	it('core-tailwind carries only the CSS-only package, never the PostCSS adapter', () => {
		// The exact key set is the point (#112): the adapter must not ride along
		// with every core-tailwind install, and an absence check would not say so.
		const tailwind = UNITS.find(u => u.id === 'core-tailwind');
		expect(Object.keys(tailwind?.devDependencies ?? {})).toEqual(['tailwindcss']);

		const postcss = UNITS.find(u => u.id === 'core-postcss');
		expect(postcss?.devDependencies).toHaveProperty('@tailwindcss/postcss');
		expect(postcss?.implies).toEqual(['core-tailwind']);
	});
});
