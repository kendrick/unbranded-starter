import { describe, expect, it } from 'vitest';
import { mergePackageJson } from './merge-json';

describe('mergePackageJson', () => {
	it('returns existing unchanged when no patches apply', () => {
		expect(mergePackageJson({ name: 'foo', version: '0.0.0' }, [])).toEqual({
			name: 'foo',
			version: '0.0.0',
		});
	});

	it('merges dependencies, letting patch win on key collision', () => {
		const result = mergePackageJson(
			{ name: 'foo', dependencies: { eslint: '^9.0.0' } },
			[{ dependencies: { eslint: '9.39.4', diff: '9.0.0' } }],
		);
		expect(result.dependencies).toEqual({ diff: '9.0.0', eslint: '9.39.4' });
	});

	it('merges devDependencies the same way', () => {
		const result = mergePackageJson(
			{ devDependencies: { typescript: '^5.0.0' } },
			[{ devDependencies: { typescript: '5.9.3' } }],
		);
		expect(result.devDependencies).toEqual({ typescript: '5.9.3' });
	});

	it('keeps existing scripts on collision (do not clobber user scripts)', () => {
		const result = mergePackageJson(
			{ scripts: { lint: 'my-custom-linter' } },
			[{ scripts: { 'lint': 'eslint .', 'lint:fix': 'eslint . --fix' } }],
		);
		expect(result.scripts).toEqual({
			'lint': 'my-custom-linter',
			'lint:fix': 'eslint . --fix',
		});
	});

	it('keeps existing engines on collision', () => {
		const result = mergePackageJson(
			{ engines: { node: '>=22' } },
			[{ engines: { node: '>=20.11', pnpm: '>=10' } }],
		);
		expect(result.engines).toEqual({ node: '>=22', pnpm: '>=10' });
	});

	it('alphabetizes dependencies', () => {
		const result = mergePackageJson(
			{},
			[{ dependencies: { 'zod': '3.0.0', 'diff': '9.0.0', '@clack/prompts': '1.4.0' } }],
		);
		expect(Object.keys(result.dependencies as object)).toEqual(['@clack/prompts', 'diff', 'zod']);
	});

	it('alphabetizes scripts', () => {
		const result = mergePackageJson(
			{},
			[{ scripts: { test: 'vitest', build: 'tsup', lint: 'eslint .' } }],
		);
		expect(Object.keys(result.scripts as object)).toEqual(['build', 'lint', 'test']);
	});

	it('orders top-level keys in conventional package.json order', () => {
		const result = mergePackageJson(
			{
				dependencies: { a: '1' },
				name: 'foo',
				scripts: { build: 'tsc' },
				version: '0.0.0',
				type: 'module',
			},
			[],
		);
		expect(Object.keys(result)).toEqual(['name', 'version', 'type', 'scripts', 'dependencies']);
	});

	it('preserves unknown keys at the end in original order', () => {
		const result = mergePackageJson(
			{ name: 'foo', customTool: { foo: 1 }, anotherTool: { bar: 2 } },
			[],
		);
		const keys = Object.keys(result);
		expect(keys.indexOf('customTool')).toBeLessThan(keys.indexOf('anotherTool'));
		expect(keys.indexOf('customTool')).toBeGreaterThan(keys.indexOf('name'));
	});

	it('applies multiple patches in order', () => {
		const result = mergePackageJson(
			{},
			[
				{ dependencies: { a: '1.0.0' } },
				{ dependencies: { b: '2.0.0' } },
				{ dependencies: { a: '3.0.0' } }, // later overrides earlier
			],
		);
		expect(result.dependencies).toEqual({ a: '3.0.0', b: '2.0.0' });
	});
});
