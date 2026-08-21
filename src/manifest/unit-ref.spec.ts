import type { UnitRefContext } from './unit-ref';
import { describe, expect, it } from 'vitest';
import { assertValidNamespace, parseUnitRef, qualify, resolveUnitRef } from './unit-ref';

describe('resolveUnitRef', () => {
	const builtinIds = new Set(['core-eslint', 'core-typescript']);

	it('resolves a bare built-in id to itself', () => {
		const ctx: UnitRefContext = { builtinIds };
		expect(resolveUnitRef('core-eslint', ctx)).toBe('core-eslint');
	});

	it('resolves a bare local id to its qualified form', () => {
		const ctx: UnitRefContext = { builtinIds, namespace: 'my-units', localBareIds: new Set(['banner']) };
		expect(resolveUnitRef('banner', ctx)).toBe('my-units/banner');
	});

	it('resolves a bare id own-source-first when it shadows a built-in', () => {
		// A local unit named core-eslint is a distinct unit from the built-in —
		// within its own directory it wins, everywhere else it stays qualified.
		const ctx: UnitRefContext = { builtinIds, namespace: 'my-units', localBareIds: new Set(['core-eslint']) };
		expect(resolveUnitRef('core-eslint', ctx)).toBe('my-units/core-eslint');
	});

	it('returns undefined for a bare id that names nothing known', () => {
		const ctx: UnitRefContext = { builtinIds, namespace: 'my-units', localBareIds: new Set(['banner']) };
		expect(resolveUnitRef('nope', ctx)).toBeUndefined();
	});

	it('resolves a qualified reference matching the loaded namespace and a local id', () => {
		const ctx: UnitRefContext = { builtinIds, namespace: 'my-units', localBareIds: new Set(['banner']) };
		expect(resolveUnitRef('my-units/banner', ctx)).toBe('my-units/banner');
	});

	it('returns undefined for a qualified reference naming the wrong namespace', () => {
		const ctx: UnitRefContext = { builtinIds, namespace: 'my-units', localBareIds: new Set(['banner']) };
		expect(resolveUnitRef('other-units/banner', ctx)).toBeUndefined();
	});

	it('returns undefined for a qualified reference whose bare id the dir does not have', () => {
		const ctx: UnitRefContext = { builtinIds, namespace: 'my-units', localBareIds: new Set(['banner']) };
		expect(resolveUnitRef('my-units/missing', ctx)).toBeUndefined();
	});

	it('returns undefined for a qualified reference when no namespace is loaded', () => {
		const ctx: UnitRefContext = { builtinIds };
		expect(resolveUnitRef('my-units/banner', ctx)).toBeUndefined();
	});

	it('returns undefined for an empty string', () => {
		const ctx: UnitRefContext = { builtinIds };
		expect(resolveUnitRef('', ctx)).toBeUndefined();
	});

	it('returns undefined for a leading slash', () => {
		const ctx: UnitRefContext = { builtinIds, namespace: 'my-units', localBareIds: new Set(['banner']) };
		expect(resolveUnitRef('/banner', ctx)).toBeUndefined();
	});

	it('returns undefined for a trailing slash', () => {
		const ctx: UnitRefContext = { builtinIds, namespace: 'my-units', localBareIds: new Set(['banner']) };
		expect(resolveUnitRef('my-units/', ctx)).toBeUndefined();
	});

	it('returns undefined for more than one slash', () => {
		const ctx: UnitRefContext = { builtinIds, namespace: 'my-units', localBareIds: new Set(['banner']) };
		expect(resolveUnitRef('my-units/banner/extra', ctx)).toBeUndefined();
	});
});

describe('parseUnitRef', () => {
	it('splits on the first slash only', () => {
		expect(parseUnitRef('my-units/banner/extra')).toEqual({ namespace: 'my-units', bare: 'banner/extra' });
	});

	it('treats a slash-free string as bare', () => {
		expect(parseUnitRef('core-eslint')).toEqual({ bare: 'core-eslint' });
	});
});

describe('qualify', () => {
	it('joins namespace and bare id with a slash', () => {
		expect(qualify('my-units', 'banner')).toBe('my-units/banner');
	});
});

describe('assertValidNamespace', () => {
	it('accepts a well-formed basename', () => {
		expect(() => assertValidNamespace('my-units')).not.toThrow();
	});

	it('rejects a basename with a space', () => {
		expect(() => assertValidNamespace('My Units')).toThrow();
	});

	it('rejects a basename with a dot', () => {
		expect(() => assertValidNamespace('units.local')).toThrow();
	});

	it('rejects a basename with a leading hyphen', () => {
		expect(() => assertValidNamespace('-leading')).toThrow();
	});

	it('rejects an empty basename', () => {
		expect(() => assertValidNamespace('')).toThrow();
	});
});
