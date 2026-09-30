import type { Unit, UnitId } from './types';
import { describe, expect, it } from 'vitest';
import { IMPLIES_ONE_OF, UNITS } from './index';
import { applyPinLines } from './pin-lines';
import { dependentsOf, exclusionAgainstTracked, resolveSelection } from './resolve';

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

describe('dependentsOf through a slot', () => {
	const units = [
		unit('core-typescript'),
		unit('core-eslint', { implies: ['core-typescript'] }),
		unit('core-oxlint', { implies: ['core-typescript'] }),
		unit('core-vitest'),
		unit('opt-ci-github', { implies: ['core-vitest'] }),
	];
	const slots = [{ unit: 'opt-ci-github', anyOf: ['core-eslint', 'core-oxlint'], fallback: 'core-oxlint' }];

	it('names the slot\'s unit when the target is its only installed member', () => {
		expect(dependentsOf('core-oxlint', ['core-oxlint', 'core-typescript', 'core-vitest', 'opt-ci-github'], units, slots))
			.toEqual(['opt-ci-github']);
	});

	it('lets either lint unit go while the other stays installed', () => {
		const installed = ['core-eslint', 'core-oxlint', 'core-typescript', 'core-vitest', 'opt-ci-github'];
		expect(dependentsOf('core-oxlint', installed, units, slots)).toEqual([]);
		expect(dependentsOf('core-eslint', installed, units, slots)).toEqual([]);
	});

	it('strands the slot\'s unit when every installed member rests on the target', () => {
		const installed = ['core-eslint', 'core-oxlint', 'core-typescript', 'core-vitest', 'opt-ci-github'];
		expect(dependentsOf('core-typescript', installed, units, slots).sort())
			.toEqual(['core-eslint', 'core-oxlint', 'opt-ci-github']);
	});

	it('uses the real IMPLIES_ONE_OF by default', () => {
		expect(dependentsOf('core-oxlint', ['core-node-version', 'core-oxlint', 'core-typescript', 'core-vitest', 'opt-ci-github'], UNITS))
			.toEqual(['opt-ci-github']);
	});
});

describe('exclusionAgainstTracked', () => {
	const units = [
		unit('core-eslint'),
		unit('core-oxlint', { excludes: ['core-eslint'] }),
		unit('core-vitest'),
	];

	it('flags a selected unit that excludes a tracked one', () => {
		expect(exclusionAgainstTracked(['core-oxlint'], ['core-eslint'], units)).toEqual({ selected: 'core-oxlint', tracked: 'core-eslint' });
	});

	it('flags a selected unit that a tracked one excludes', () => {
		expect(exclusionAgainstTracked(['core-eslint'], ['core-oxlint'], units)).toEqual({ selected: 'core-eslint', tracked: 'core-oxlint' });
	});

	it('ignores tracked units that are re-selected', () => {
		expect(exclusionAgainstTracked(['core-eslint'], ['core-eslint'], units)).toBeUndefined();
	});

	it('does not flag a tracked unit that is also selected, even when a selected unit excludes it', () => {
		const hand = [unit('core-oxlint', { excludes: ['core-eslint'] }), unit('core-eslint')];
		expect(exclusionAgainstTracked(['core-oxlint', 'core-eslint'], ['core-eslint'], hand)).toBeUndefined();
	});

	it('passes unrelated units and unknown tracked ids', () => {
		expect(exclusionAgainstTracked(['core-vitest'], ['core-eslint', 'local:mine'], units)).toBeUndefined();
	});
});

describe('the TypeScript line and the lint slot, against the real manifest (#158)', () => {
	function plan(seed: string[]): { ids: string[]; typescript: string | undefined } {
		const result = resolveSelection(seed, UNITS);
		if (result.kind !== 'ok')
			throw new Error(`expected ok, got ${result.kind}`);
		const selected = new Set(result.ids);
		const ts = UNITS.find(u => u.id === 'core-typescript');
		return { ids: result.ids, typescript: ts && selected.has(ts.id) ? applyPinLines(ts, selected).devDependencies?.typescript : undefined };
	}

	it('core-typescript alone takes the 7.x line', () => {
		expect(plan(['core-typescript']).typescript).toMatch(/^7\./);
	});

	it('core-eslint implies core-typescript on the 6.x line', () => {
		const p = plan(['core-eslint']);
		expect(p.ids).toContain('core-typescript');
		expect(p.typescript).toMatch(/^6\./);
	});

	it('core-oxlint takes the 7.x line', () => {
		expect(plan(['core-oxlint']).typescript).toMatch(/^7\./);
	});

	it('opt-ci-github with no lint unit fills the slot with core-oxlint, not core-eslint', () => {
		const p = plan(['opt-ci-github']);
		expect(p.ids).toContain('core-oxlint');
		expect(p.ids).not.toContain('core-eslint');
	});

	it('opt-ci-github beside core-eslint keeps core-eslint and adds no core-oxlint', () => {
		const p = plan(['core-eslint', 'opt-ci-github']);
		expect(p.ids).toContain('core-eslint');
		expect(p.ids).not.toContain('core-oxlint');
		expect(p.typescript).toMatch(/^6\./);
	});

	it('records the slot fill as auto, required by the slot\'s unit', () => {
		const result = resolveSelection(['opt-ci-github'], UNITS);
		expect(result.kind === 'ok' && result.auto).toContain('core-oxlint');
		expect(result.kind === 'ok' && result.requiredBy['core-oxlint']).toBe('opt-ci-github');
	});

	it('a tracked lint unit satisfies the slot without joining the plan', () => {
		const result = resolveSelection(['opt-ci-github'], UNITS, IMPLIES_ONE_OF, ['core-eslint']);
		expect(result.kind === 'ok' && result.ids).not.toContain('core-oxlint');
		expect(result.kind === 'ok' && result.ids).not.toContain('core-eslint');
	});

	it('a tracked core-eslint holds core-typescript on the 6.x line', () => {
		const result = resolveSelection(['core-typescript'], UNITS, IMPLIES_ONE_OF, ['core-eslint']);
		if (result.kind !== 'ok')
			throw new Error(`expected ok, got ${result.kind}`);
		const ts = UNITS.find(u => u.id === 'core-typescript')!;
		expect(applyPinLines(ts, new Set([...result.ids, 'core-eslint'])).devDependencies?.typescript).toMatch(/^6\./);
	});

	it('lets a lint unit implied by another unit satisfy the slot', () => {
		const units = [
			...UNITS.filter(u => u.id !== 'opt-ci-github'),
			{ ...UNITS.find(u => u.id === 'opt-ci-github')!, implies: [...(UNITS.find(u => u.id === 'opt-ci-github')!.implies ?? []), 'core-eslint'] },
		];
		const result = resolveSelection(['opt-ci-github'], units, IMPLIES_ONE_OF);
		expect(result.kind === 'ok' && result.ids).not.toContain('core-oxlint');
	});
});
