import type { Unit, UnitId } from './types';
import { describe, expect, it } from 'vitest';
import { dependentsOf, resolveSelection } from './resolve';

// Minimal fixture builder so tests stay readable.
function unit(id: UnitId, extras: Partial<Unit> = {}): Unit {
	return {
		id,
		category: 'lint',
		label: id,
		description: '',
		files: [],
		...extras,
	};
}

describe('resolveSelection', () => {
	it('returns the seed verbatim when no implies/requires/excludes apply', () => {
		const units = [unit('core-eslint'), unit('core-typescript')];
		expect(resolveSelection(['core-eslint'], units)).toEqual({
			kind: 'ok',
			ids: ['core-eslint'],
			auto: [],
			requiredBy: {},
		});
	});

	it('auto-adds transitively implied units', () => {
		const units = [
			unit('core-eslint', { implies: ['core-typescript'] }),
			unit('core-typescript', { implies: ['core-tailwind'] }),
			unit('core-tailwind'),
		];
		const result = resolveSelection(['core-eslint'], units);
		expect(result).toMatchObject({ kind: 'ok' });
		if (result.kind !== 'ok')
			return;
		expect(new Set(result.ids)).toEqual(new Set(['core-eslint', 'core-typescript', 'core-tailwind']));
		expect(new Set(result.auto)).toEqual(new Set(['core-typescript', 'core-tailwind']));
	});

	it('does not mark seed units as auto even if also implied', () => {
		const units = [
			unit('core-eslint', { implies: ['core-typescript'] }),
			unit('core-typescript'),
		];
		const result = resolveSelection(['core-eslint', 'core-typescript'], units);
		expect(result).toMatchObject({ kind: 'ok' });
		if (result.kind !== 'ok')
			return;
		expect(result.auto).toEqual([]);
		// A unit the user picked explicitly is never "required by" anything, even
		// when another selection also implies it — the plan shouldn't annotate it.
		expect(result.requiredBy).toEqual({});
	});

	it('records the direct requirer of an auto-added unit', () => {
		const units = [
			unit('core-eslint', { implies: ['core-typescript'] }),
			unit('core-typescript'),
		];
		const result = resolveSelection(['core-eslint'], units);
		expect(result).toMatchObject({ kind: 'ok' });
		if (result.kind !== 'ok')
			return;
		expect(result.requiredBy).toEqual({ 'core-typescript': 'core-eslint' });
	});

	it('attributes a transitively-implied unit to its nearest requirer, not the seed', () => {
		// A → B → C: C is pulled in by B, so the plan should read "required by B",
		// not "required by A". Recording the nearest requirer is the whole point.
		const units = [
			unit('core-eslint', { implies: ['core-typescript'] }),
			unit('core-typescript', { implies: ['core-tailwind'] }),
			unit('core-tailwind'),
		];
		const result = resolveSelection(['core-eslint'], units);
		expect(result).toMatchObject({ kind: 'ok' });
		if (result.kind !== 'ok')
			return;
		expect(result.requiredBy).toEqual({
			'core-typescript': 'core-eslint',
			'core-tailwind': 'core-typescript',
		});
	});

	it('credits the first requirer when two selected units imply the same unit', () => {
		// Diamond: both seeds imply core-typescript. First-writer-wins keeps the
		// attribution stable at the earlier seed instead of flip-flopping.
		const units = [
			unit('core-eslint', { implies: ['core-typescript'] }),
			unit('core-stylelint', { implies: ['core-typescript'] }),
			unit('core-typescript'),
		];
		const result = resolveSelection(['core-eslint', 'core-stylelint'], units);
		expect(result).toMatchObject({ kind: 'ok' });
		if (result.kind !== 'ok')
			return;
		expect(result.requiredBy).toEqual({ 'core-typescript': 'core-eslint' });
	});

	it('flags missing-required when a hard precondition is absent', () => {
		const units = [
			unit('opt-shadcn', { requires: ['core-tailwind'] }),
			unit('core-tailwind'),
		];
		expect(resolveSelection(['opt-shadcn'], units)).toEqual({
			kind: 'missing-required',
			unit: 'opt-shadcn',
			needs: ['core-tailwind'],
		});
	});

	it('passes requires when the dependency is in the seed', () => {
		const units = [
			unit('opt-shadcn', { requires: ['core-tailwind'] }),
			unit('core-tailwind'),
		];
		expect(resolveSelection(['opt-shadcn', 'core-tailwind'], units)).toMatchObject({ kind: 'ok' });
	});

	it('detects a one-sided exclude (treats it as symmetric)', () => {
		const units = [
			unit('core-eslint', { excludes: ['core-stylelint'] }),
			unit('core-stylelint'),
		];
		const result = resolveSelection(['core-eslint', 'core-stylelint'], units);
		expect(result).toMatchObject({ kind: 'conflict' });
		if (result.kind !== 'conflict')
			return;
		expect(new Set(result.pair)).toEqual(new Set(['core-eslint', 'core-stylelint']));
	});

	it('detects a conflict introduced by implies closure', () => {
		// A implies B; B excludes C; C is in the seed alongside A.
		const units = [
			unit('core-eslint', { implies: ['core-typescript'] }),
			unit('core-typescript', { excludes: ['core-stylelint'] }),
			unit('core-stylelint'),
		];
		const result = resolveSelection(['core-eslint', 'core-stylelint'], units);
		expect(result.kind).toBe('conflict');
	});
});

describe('dependentsOf', () => {
	// shadcn implies tailwind; postcss implies tailwind; ci requires eslint.
	const units = [
		unit('core-tailwind'),
		unit('opt-shadcn', { implies: ['core-tailwind'] }),
		unit('core-postcss', { implies: ['core-tailwind'] }),
		unit('core-eslint'),
		unit('opt-ci-github', { requires: ['core-eslint'] }),
		unit('core-typescript'),
	];

	it('names every installed unit whose implies or requires reaches the target', () => {
		expect(dependentsOf('core-tailwind', ['core-tailwind', 'opt-shadcn', 'core-postcss'], units).sort())
			.toEqual(['core-postcss', 'opt-shadcn']);
		expect(dependentsOf('core-eslint', ['core-eslint', 'opt-ci-github'], units))
			.toEqual(['opt-ci-github']);
	});

	it('walks transitive edges, not just direct ones', () => {
		// a implies b, b implies c: removing c strands both a and b.
		const chain = [
			unit('core-tailwind'),
			unit('core-postcss', { implies: ['core-tailwind'] }),
			unit('opt-shadcn', { implies: ['core-postcss'] }),
		];
		expect(dependentsOf('core-tailwind', ['core-tailwind', 'core-postcss', 'opt-shadcn'], chain).sort())
			.toEqual(['core-postcss', 'opt-shadcn']);
	});

	it('only counts installed units — the rest of the catalog is irrelevant', () => {
		// opt-shadcn depends on tailwind but is not installed here.
		expect(dependentsOf('core-tailwind', ['core-tailwind', 'core-typescript'], units)).toEqual([]);
	});

	it('returns empty for a leaf unit nothing points at', () => {
		expect(dependentsOf('core-typescript', ['core-typescript', 'core-eslint'], units)).toEqual([]);
	});
});
