import { describe, expect, it } from 'vitest';
import { buildEslintConfig, detectEslintFlavor, ESLINT_FLAVORS, eslintDevDependencies } from './eslint-config';

// The React ecosystem packages base must never pull. The AC is explicit:
// `base` installs zero React-ecosystem packages.
const REACT_PACKAGES = ['@eslint-react/eslint-plugin', 'eslint-plugin-jsx-a11y', 'eslint-plugin-react-refresh', '@next/eslint-plugin-next'];

describe('detectEslintFlavor', () => {
	it('returns "next" when next is a dependency', () => {
		expect(detectEslintFlavor(['react', 'next', 'react-dom'])).toBe('next');
	});

	it('returns "react" when react is present but next is not', () => {
		expect(detectEslintFlavor(['react', 'react-dom'])).toBe('react');
	});

	it('falls back to "base" for a plain package with neither', () => {
		expect(detectEslintFlavor(['zod', 'commander'])).toBe('base');
		expect(detectEslintFlavor([])).toBe('base');
	});

	it('prefers next over react when both are present (next is the superset)', () => {
		expect(detectEslintFlavor(['next', 'react'])).toBe('next');
	});
});

describe('eslintDevDependencies', () => {
	it('base installs zero React-ecosystem packages', () => {
		const deps = eslintDevDependencies('base');
		for (const pkg of REACT_PACKAGES)
			expect(deps).not.toHaveProperty(pkg);
		// ...but still ships the linter core and the formatter peer the config needs.
		expect(deps).toHaveProperty('@antfu/eslint-config');
		expect(deps).toHaveProperty('eslint');
		expect(deps).toHaveProperty('eslint-plugin-format');
	});

	it('react adds the react peers and jsx-a11y, but not the next plugin', () => {
		const deps = eslintDevDependencies('react');
		expect(deps).toHaveProperty('@eslint-react/eslint-plugin');
		expect(deps).toHaveProperty('eslint-plugin-react-refresh');
		expect(deps).toHaveProperty('eslint-plugin-jsx-a11y');
		expect(deps).not.toHaveProperty('@next/eslint-plugin-next');
	});

	it('next is a superset of react plus the next plugin', () => {
		const deps = eslintDevDependencies('next');
		expect(deps).toHaveProperty('@eslint-react/eslint-plugin');
		expect(deps).toHaveProperty('@next/eslint-plugin-next');
	});
});

describe('buildEslintConfig', () => {
	it('every flavor is a valid-looking antfu config module', () => {
		for (const flavor of ESLINT_FLAVORS) {
			const src = buildEslintConfig(flavor);
			expect(src.startsWith('import antfu from \'@antfu/eslint-config\';')).toBe(true);
			expect(src).toContain('export default antfu(');
			expect(src).toContain('typescript: true,');
			expect(src.endsWith('\n')).toBe(true);
		}
	});

	it('base omits every React/Next toggle, rule, and the jsx-a11y import/block', () => {
		const src = buildEslintConfig('base');
		expect(src).not.toContain('react: true');
		expect(src).not.toContain('nextjs: true');
		expect(src).not.toContain('@next/next/');
		expect(src).not.toContain('jsx-a11y');
		expect(src).not.toContain('eslint-plugin-jsx-a11y');
	});

	it('react turns on react and the jsx-a11y block but leaves next off', () => {
		const src = buildEslintConfig('react');
		expect(src).toContain('react: true,');
		expect(src).toContain('import jsxA11y from \'eslint-plugin-jsx-a11y\';');
		expect(src).toContain('\'jsx-a11y/alt-text\': \'error\',');
		expect(src).not.toContain('nextjs: true');
		expect(src).not.toContain('@next/next/');
	});

	it('next turns on react, nextjs, and the @next performance rules', () => {
		const src = buildEslintConfig('next');
		expect(src).toContain('react: true,');
		expect(src).toContain('nextjs: true,');
		expect(src).toContain('\'@next/next/no-img-element\': \'error\',');
		expect(src).toContain('import jsxA11y from \'eslint-plugin-jsx-a11y\';');
	});
});
