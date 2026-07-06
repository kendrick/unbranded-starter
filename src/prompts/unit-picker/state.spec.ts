import type { Unit, UnitId } from '../../manifest/types';
import { describe, expect, it } from 'vitest';
import { createPickerState, filteredOptions, pickerRows, pickerSummary, reducePicker } from './state';

function unit(id: UnitId, extras: Partial<Unit> = {}): Unit {
	return { id, category: 'lint', label: id, description: '', files: [], ...extras };
}

const UNITS: Unit[] = [
	unit('core-editorconfig', { category: 'foundation', label: 'EditorConfig' }),
	unit('core-eslint', {
		category: 'lint',
		label: 'ESLint',
		implies: ['core-typescript'],
		options: [{
			key: 'eslintFlavor',
			label: 'ESLint flavor',
			default: 'base',
			choices: [{ value: 'base', label: 'Base' }, { value: 'react', label: 'React' }, { value: 'next', label: 'Next.js' }],
		}],
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
		expect(filteredOptions(typeFilter(state(), 'esl')).map(o => o.value)).toEqual(['core-eslint']);
	});

	it('filters on the group label', () => {
		// "found" appears only in the Foundation group header, not any label or id.
		expect(filteredOptions(typeFilter(state(), 'found')).map(o => o.value)).toEqual(['core-editorconfig']);
	});

	it('filters on the raw id', () => {
		expect(filteredOptions(typeFilter(state(), 'vitest')).map(o => o.value)).toEqual(['core-vitest']);
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
	it('cycles the active row\'s flavor, wrapping both directions', () => {
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
		expect(pickerRows(s).map(r => r.kind)).toEqual([
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
		expect(filtered.filter(r => r.kind === 'header').map(r => r.kind === 'header' && r.group)).toEqual(['Linting']);
	});

	it('counts selected units per group in the header', () => {
		let s = reducePicker(state(), { type: 'move', delta: 1 });
		s = reducePicker(s, { type: 'toggle' }); // select core-eslint
		const header = pickerRows(s).find(r => r.kind === 'header' && r.group === 'Linting');
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
			options: [{
				key: 'eslintFlavor',
				label: 'ESLint flavor',
				default: 'base',
				choices: [
					{ value: 'base', label: 'Base', files: [{ content: 'x', dest: 'eslint.config.mjs' }], devDependencies: { '@antfu/eslint-config': '1' } },
					{ value: 'react', label: 'React', files: [{ content: 'x', dest: 'eslint.config.mjs' }], devDependencies: { '@antfu/eslint-config': '1', 'eslint-plugin-jsx-a11y': '1' } },
				],
			}],
		}),
		unit('core-typescript', {
			category: 'types',
			label: 'TypeScript',
			files: [{ src: 'a', dest: 'tsconfig.base.json' }, { src: 'b', dest: 'tsconfig.json' }],
			devDependencies: { typescript: '5' },
		}),
	];

	it('counts nothing until something is selected', () => {
		expect(pickerSummary(createPickerState(flavored, new Set()))).toEqual({ units: 0, files: 0, deps: 0 });
	});

	it('counts explicit picks, the implied preview, and the chosen flavor\'s footprint', () => {
		let s = createPickerState(flavored, new Set());
		s = reducePicker(s, { type: 'toggle' }); // pick core-eslint (base); implies core-typescript
		// eslint base: 1 file + 1 dep; typescript: 2 files + 1 dep.
		expect(pickerSummary(s)).toEqual({ units: 2, files: 3, deps: 2 });
		s = reducePicker(s, { type: 'cycleFlavor', delta: 1 }); // → react adds a dep
		expect(pickerSummary(s)).toEqual({ units: 2, files: 3, deps: 3 });
	});
});
