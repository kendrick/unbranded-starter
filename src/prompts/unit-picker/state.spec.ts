import type { Unit, UnitId } from '../../manifest/types';
import { describe, expect, it } from 'vitest';
import { UNITS as REAL_UNITS } from '../../manifest';
import {
	createPickerState,
	filteredOptions,
	pickerRows,
	pickerSummary,
	reducePicker,
} from './state';
import type { PickerState } from './state';

function unit(id: UnitId, extras: Partial<Unit> = {}): Unit {
	return { id, category: 'lint', label: id, description: '', files: [], ...extras };
}

const UNITS: Unit[] = [
	unit('core-editorconfig', { category: 'foundation', label: 'EditorConfig' }),
	unit('core-eslint', {
		category: 'lint',
		label: 'ESLint',
		implies: ['core-typescript'],
		options: [
			{
				key: 'eslintFlavor',
				label: 'ESLint flavor',
				default: 'base',
				choices: [
					{ value: 'base', label: 'Base' },
					{ value: 'react', label: 'React' },
					{ value: 'next', label: 'Next.js' },
				],
			},
		],
	}),
	unit('core-typescript', { category: 'types', label: 'TypeScript' }),
	unit('core-vitest', { category: 'test', label: 'Vitest' }),
];

function state(installed: UnitId[] = [], flavors: Record<string, string> = {}) {
	return createPickerState(UNITS, new Set(installed), flavors);
}

function typeFilter(s: ReturnType<typeof state>, text: string) {
	return [...text].reduce((acc, char) => reducePicker(acc, { type: 'char', char }), s);
}

describe('reducePicker filtering', () => {
	it('filters case-insensitively on the label', () => {
		expect(filteredOptions(typeFilter(state(), 'esl')).map((o) => o.value)).toEqual([
			'core-eslint',
		]);
	});

	it('filters on the group label', () => {
		// "found" appears only in the Foundation group header, not any label or id.
		expect(filteredOptions(typeFilter(state(), 'found')).map((o) => o.value)).toEqual([
			'core-editorconfig',
		]);
	});

	it('filters on the raw id', () => {
		expect(filteredOptions(typeFilter(state(), 'vitest')).map((o) => o.value)).toEqual([
			'core-vitest',
		]);
	});

	it('keeps a selection made under a filter after the filter clears', () => {
		let s = typeFilter(state(), 'vitest');
		s = reducePicker(s, { type: 'toggle' });
		expect(s.selected.has('core-vitest')).toBe(true);
		s = reducePicker(s, { type: 'clearFilter' });
		expect(s.selected.has('core-vitest')).toBe(true);
		expect(filteredOptions(s)).toHaveLength(4);
	});

	it('re-anchors the cursor to the highlighted option when filtering', () => {
		let s = reducePicker(state(), { type: 'move', delta: 2 });
		expect(filteredOptions(s)[s.cursor]?.value).toBe('core-typescript');
		s = typeFilter(s, 'type');
		expect(filteredOptions(s)[s.cursor]?.value).toBe('core-typescript');
	});

	it('clamps the cursor when the highlighted option is filtered away', () => {
		let s = reducePicker(state(), { type: 'move', delta: 3 }); // core-vitest
		s = typeFilter(s, 'esl'); // core-vitest gone; must clamp into the shorter list
		expect(s.cursor).toBe(0);
		expect(filteredOptions(s)[s.cursor]?.value).toBe('core-eslint');
	});
});

describe('reducePicker movement and expansion', () => {
	it('clamps movement at both ends without wrapping', () => {
		expect(reducePicker(state(), { type: 'move', delta: -1 }).cursor).toBe(0);
		expect(reducePicker(state(), { type: 'move', delta: 99 }).cursor).toBe(3);
	});

	it('collapses an expanded detail on move', () => {
		let s = reducePicker(state(), { type: 'toggleExpand' });
		expect(s.expanded).toBe('core-editorconfig');
		s = reducePicker(s, { type: 'move', delta: 1 });
		expect(s.expanded).toBeNull();
	});

	it('expands at most one row and never moves the cursor', () => {
		let s = reducePicker(state(), { type: 'move', delta: 1 });
		const cursor = s.cursor;
		s = reducePicker(s, { type: 'toggleExpand' });
		expect(s.expanded).toBe('core-eslint');
		expect(s.cursor).toBe(cursor);
		s = reducePicker(s, { type: 'toggleExpand' });
		expect(s.expanded).toBeNull();
	});
});

describe('reducePicker selection and implies preview', () => {
	it('toggles selection and previews the implied unit as auto with its requirer', () => {
		let s = reducePicker(state(), { type: 'move', delta: 1 }); // core-eslint
		s = reducePicker(s, { type: 'toggle' });
		expect(s.selected.has('core-eslint')).toBe(true);
		expect(s.selected.has('core-typescript')).toBe(false); // implied, not explicit
		expect(s.auto.has('core-typescript')).toBe(true);
		expect(s.requiredBy['core-typescript']).toBe('core-eslint');
	});

	it('clears the auto preview when the implying unit is deselected', () => {
		let s = reducePicker(state(), { type: 'move', delta: 1 });
		s = reducePicker(s, { type: 'toggle' });
		s = reducePicker(s, { type: 'toggle' });
		expect(s.selected.has('core-eslint')).toBe(false);
		expect(s.auto.has('core-typescript')).toBe(false);
	});
});

describe('createPickerState initial selection', () => {
	it('seeds explicit picks and the implies preview from initialSelected', () => {
		const s = createPickerState(UNITS, new Set(), {}, ['core-eslint', 'core-vitest']);
		expect(s.selected.has('core-eslint')).toBe(true);
		expect(s.selected.has('core-vitest')).toBe(true);
		// The preview must reflect the seed immediately, not wait for a toggle.
		expect(s.auto.has('core-typescript')).toBe(true);
		expect(s.requiredBy['core-typescript']).toBe('core-eslint');
	});

	it('drops seeded ids that are not in the unit list', () => {
		const s = createPickerState(UNITS, new Set(), {}, ['core-eslint', 'opt-playwright']);
		expect(s.selected.has('core-eslint')).toBe(true);
		expect(s.selected.has('opt-playwright')).toBe(false);
	});

	it('defaults to an empty selection', () => {
		expect(state().selected.size).toBe(0);
		expect(state().auto.size).toBe(0);
	});
});

describe('reducePicker flavor cycling', () => {
	it("cycles the active row's flavor, wrapping both directions", () => {
		let s = reducePicker(state(), { type: 'move', delta: 1 }); // core-eslint
		expect(s.flavors.eslintFlavor).toBe('base');
		s = reducePicker(s, { type: 'cycleFlavor', delta: 1 });
		expect(s.flavors.eslintFlavor).toBe('react');
		s = reducePicker(s, { type: 'cycleFlavor', delta: 1 });
		s = reducePicker(s, { type: 'cycleFlavor', delta: 1 }); // wraps base→react→next→base
		expect(s.flavors.eslintFlavor).toBe('base');
		s = reducePicker(s, { type: 'cycleFlavor', delta: -1 }); // wraps backward
		expect(s.flavors.eslintFlavor).toBe('next');
	});

	it('ignores flavor cycling on a row with no options', () => {
		const s = state(); // cursor 0 = core-editorconfig, no options
		expect(reducePicker(s, { type: 'cycleFlavor', delta: 1 }).flavors).toEqual(s.flavors);
	});

	it('seeds initial flavors from the caller, else the option default', () => {
		expect(state([], { eslintFlavor: 'next' }).flavors.eslintFlavor).toBe('next');
		expect(state().flavors.eslintFlavor).toBe('base');
	});
});

describe('pickerRows', () => {
	it('interleaves headers, options, and the expanded detail; empty groups vanish under filter', () => {
		let s = reducePicker(state(), { type: 'move', delta: 1 }); // core-eslint active
		s = reducePicker(s, { type: 'toggleExpand' });
		expect(pickerRows(s).map((r) => r.kind)).toEqual([
			'header',
			'option', // Foundation / EditorConfig
			'header',
			'option',
			'detail', // Linting / ESLint / (expanded)
			'header',
			'option', // TypeScript / TypeScript
			'header',
			'option', // Testing / Vitest
		]);

		const filtered = pickerRows(typeFilter(s, 'esl'));
		expect(
			filtered.filter((r) => r.kind === 'header').map((r) => r.kind === 'header' && r.group),
		).toEqual(['Linting']);
	});

	it('counts selected units per group in the header', () => {
		let s = reducePicker(state(), { type: 'move', delta: 1 });
		s = reducePicker(s, { type: 'toggle' }); // select core-eslint
		const header = pickerRows(s).find((r) => r.kind === 'header' && r.group === 'Linting');
		expect(header).toMatchObject({ selected: 1, total: 1 });
	});
});

describe('pickerSummary', () => {
	// A richer fixture: core-eslint's files/deps live in flavor choices, so the count
	// must bake the flavor in rather than read the (empty) static footprint.
	const flavored: Unit[] = [
		unit('core-eslint', {
			label: 'ESLint',
			implies: ['core-typescript'],
			options: [
				{
					key: 'eslintFlavor',
					label: 'ESLint flavor',
					default: 'base',
					choices: [
						{
							value: 'base',
							label: 'Base',
							files: [{ content: 'x', dest: 'eslint.config.mjs' }],
							devDependencies: { '@antfu/eslint-config': '1' },
						},
						{
							value: 'react',
							label: 'React',
							files: [{ content: 'x', dest: 'eslint.config.mjs' }],
							devDependencies: { '@antfu/eslint-config': '1', 'eslint-plugin-jsx-a11y': '1' },
						},
					],
				},
			],
		}),
		unit('core-typescript', {
			category: 'types',
			label: 'TypeScript',
			files: [
				{ src: 'a', dest: 'tsconfig.base.json' },
				{ src: 'b', dest: 'tsconfig.json' },
			],
			devDependencies: { typescript: '5' },
		}),
	];

	it('counts nothing until something is selected', () => {
		expect(pickerSummary(createPickerState(flavored, new Set()))).toEqual({
			units: 0,
			files: 0,
			deps: 0,
		});
	});

	it("counts explicit picks, the implied preview, and the chosen flavor's footprint", () => {
		let s = createPickerState(flavored, new Set());
		s = reducePicker(s, { type: 'toggle' }); // pick core-eslint (base); implies core-typescript
		// eslint base: 1 file + 1 dep; typescript: 2 files + 1 dep.
		expect(pickerSummary(s)).toEqual({ units: 2, files: 3, deps: 2 });
		s = reducePicker(s, { type: 'cycleFlavor', delta: 1 }); // → react adds a dep
		expect(pickerSummary(s)).toEqual({ units: 2, files: 3, deps: 3 });
	});
});

describe('typescriptLine coupling with the real manifest', () => {
	function realState() {
		return createPickerState(REAL_UNITS, new Set());
	}
	function typeFilter(s: PickerState, text: string) {
		return [...text].reduce((acc, char) => reducePicker(acc, { type: 'char', char }), s);
	}
	function pick(s: PickerState, id: string) {
		const filtered = reducePicker(typeFilter(s, id), { type: 'clearFilter' });
		const idx = filteredOptions(filtered).findIndex((o) => o.value === id);
		return reducePicker({ ...filtered, cursor: idx }, { type: 'toggle' });
	}
	function cycleOn(s: PickerState, id: string, delta: number) {
		const idx = filteredOptions(s).findIndex((o) => o.value === id);
		return reducePicker({ ...s, cursor: idx }, { type: 'cycleFlavor', delta });
	}

	it('snaps typescriptLine 7 to 6 when core-eslint is toggled on', () => {
		const s = createPickerState(REAL_UNITS, new Set(), { typescriptLine: '7' });
		expect(s.flavors.typescriptLine).toBe('7');
		expect(pick(s, 'core-eslint').flavors.typescriptLine).toBe('6');
	});

	it('leaves typescriptLine alone when core-oxlint is toggled on', () => {
		expect(pick(realState(), 'core-oxlint').flavors.typescriptLine).toBe('7');
	});

	it('skips 7 when cycling the TypeScript row beside core-eslint', () => {
		const s = pick(
			createPickerState(REAL_UNITS, new Set(), { typescriptLine: '6' }),
			'core-eslint',
		);
		expect(cycleOn(s, 'core-typescript', 1).flavors.typescriptLine).toBe('6');
		expect(cycleOn(s, 'core-typescript', -1).flavors.typescriptLine).toBe('6');
	});

	it('cycles between 7 and 6 beside core-oxlint', () => {
		const s = pick(realState(), 'core-oxlint');
		const six = cycleOn(s, 'core-typescript', 1);
		expect(six.flavors.typescriptLine).toBe('6');
		expect(cycleOn(six, 'core-typescript', 1).flavors.typescriptLine).toBe('7');
	});

	it('counts typescript once for a core-eslint selection', () => {
		const s = pick(realState(), 'core-eslint');
		expect(s.flavors.typescriptLine).toBe('6');
		// core-eslint base: @antfu/eslint-config, eslint, eslint-plugin-format, and
		// eslint.config.mjs. core-typescript: @types/node, typescript, and the two
		// tsconfigs. Counted by hand off the manifest, so a doubled option bake or a
		// typescript pin counted twice moves a number here.
		expect(pickerSummary(s)).toEqual({ units: 2, files: 3, deps: 5 });
	});
});

describe('typescriptLine coupling against installed units', () => {
	function cycleOn(s: PickerState, id: string, delta: number) {
		const idx = filteredOptions(s).findIndex((o) => o.value === id);
		return reducePicker({ ...s, cursor: idx }, { type: 'cycleFlavor', delta });
	}

	it('skips 7 when cycling the TypeScript row beside an installed core-eslint', () => {
		const s = createPickerState(REAL_UNITS, new Set(['core-eslint']), { typescriptLine: '6' }, [
			'core-typescript',
		]);
		expect(cycleOn(s, 'core-typescript', 1).flavors.typescriptLine).toBe('6');
		expect(cycleOn(s, 'core-typescript', -1).flavors.typescriptLine).toBe('6');
	});

	it('opens on 6 when a seeded 7 sits beside an installed core-eslint', () => {
		const s = createPickerState(REAL_UNITS, new Set(['core-eslint']), { typescriptLine: '7' });
		expect(s.flavors.typescriptLine).toBe('6');
	});
});

describe('typescriptLine snap memory', () => {
	function at(s: PickerState, id: string): PickerState {
		return { ...s, cursor: filteredOptions(s).findIndex((o) => o.value === id) };
	}
	function toggle(s: PickerState, id: string): PickerState {
		return reducePicker(at(s, id), { type: 'toggle' });
	}
	function seven(installed: string[] = []): PickerState {
		return createPickerState(REAL_UNITS, new Set(installed), { typescriptLine: '7' });
	}

	it('restores 7 once core-eslint is toggled back off', () => {
		const on = toggle(seven(), 'core-eslint');
		expect(on.flavors.typescriptLine).toBe('6');
		const off = toggle(on, 'core-eslint');
		expect(off.flavors.typescriptLine).toBe('7');
		expect(toggle(off, 'core-oxlint').flavors.typescriptLine).toBe('7');
	});

	it('holds the snapped value through unrelated toggles while core-eslint stays on', () => {
		let s = toggle(seven(), 'core-eslint');
		s = toggle(s, 'core-vitest');
		expect(s.flavors.typescriptLine).toBe('6');
		s = toggle(s, 'core-vitest');
		expect(s.flavors.typescriptLine).toBe('6');
		expect(toggle(s, 'core-eslint').flavors.typescriptLine).toBe('7');
	});

	it("never overwrites the user's own cycle with a restore", () => {
		let s = toggle(seven(), 'core-eslint');
		s = reducePicker(at(s, 'core-typescript'), { type: 'cycleFlavor', delta: 1 });
		expect(s.flavors.typescriptLine).toBe('6');
		expect(toggle(s, 'core-eslint').flavors.typescriptLine).toBe('6');
	});

	it('keeps 6 while an installed core-eslint still rules 7 out', () => {
		let s = toggle(seven(['core-eslint']), 'core-vitest');
		expect(s.flavors.typescriptLine).toBe('6');
		s = toggle(s, 'core-vitest');
		expect(s.flavors.typescriptLine).toBe('6');
	});
});
