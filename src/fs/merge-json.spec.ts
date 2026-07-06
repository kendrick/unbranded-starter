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

	it('adds packageManager when the target has none', () => {
		const result = mergePackageJson(
			{ name: 'foo' },
			[{ packageManager: 'pnpm@10.0.0' }],
		);
		expect(result.packageManager).toBe('pnpm@10.0.0');
	});

	it('keeps an existing packageManager rather than clobbering the user pin', () => {
		// Corepack treats this field as authoritative; if the user already pinned
		// a version we must not silently swap it for the ambient one.
		const result = mergePackageJson(
			{ packageManager: 'yarn@4.1.0' },
			[{ packageManager: 'pnpm@10.0.0' }],
		);
		expect(result.packageManager).toBe('yarn@4.1.0');
	});

	it('orders packageManager ahead of engines, both ahead of scripts (antfu order)', () => {
		const result = mergePackageJson(
			{ name: 'foo', scripts: { build: 'tsc' }, engines: { node: '>=22' } },
			[{ packageManager: 'pnpm@10.0.0' }],
		);
		expect(Object.keys(result)).toEqual(['name', 'packageManager', 'engines', 'scripts']);
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

	it('orders top-level keys the way the shipped antfu config expects', () => {
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
		// antfu's sortPackageJson puts `type` ahead of `version`; getting this wrong is
		// exactly what trips `jsonc/sort-keys` on a fresh scaffold (#48).
		expect(Object.keys(result)).toEqual(['name', 'type', 'version', 'scripts', 'dependencies']);
	});

	it('honors antfu\'s specific quirks: type before version, packageManager before description', () => {
		const result = mergePackageJson(
			{ description: 'x', version: '0.0.0', type: 'module', packageManager: 'pnpm@10.0.0', name: 'foo' },
			[],
		);
		expect(Object.keys(result)).toEqual(['name', 'type', 'version', 'packageManager', 'description']);
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
