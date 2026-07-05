import type { Unit, UnitId } from '../../manifest/types';
import type { PickerTheme, PickerView } from './render';
import type { PickerState } from './state';
import { describe, expect, it } from 'vitest';
import { renderUnitPicker } from './render';
import { createPickerState, reducePicker } from './state';

// Tag-fake theme: visible ASCII markers instead of ANSI so snapshots are stable and
// prove exactly which spans got which style. d{} dim, a{} active, s{} selected.
const theme: PickerTheme = {
	dim: s => `d{${s}}`,
	active: s => `a{${s}}`,
	selected: s => `s{${s}}`,
	pointer: '>',
	boxOn: '[x]',
	boxOff: '[ ]',
	boxAuto: '[~]',
	symbol: '?',
};

function unit(id: UnitId, extras: Partial<Unit> = {}): Unit {
	return { id, category: 'lint', label: id, description: '', files: [], ...extras };
}

const UNITS: Unit[] = [
	unit('core-editorconfig', { category: 'foundation', label: 'EditorConfig', description: 'Whitespace rules.', files: [{ src: 'a', dest: '.editorconfig' }] }),
	unit('core-eslint', {
		category: 'lint',
		label: 'ESLint',
		description: 'Lint JS and TS.',
		implies: ['core-typescript'],
		options: [{
			key: 'eslintFlavor',
			label: 'ESLint flavor',
			default: 'base',
			choices: [{ value: 'base', label: 'Base' }, { value: 'react', label: 'React' }, { value: 'next', label: 'Next.js' }],
		}],
	}),
	unit('core-typescript', {
		category: 'types',
		label: 'TypeScript',
		description: 'Strict TS.',
		files: [{ src: 'a', dest: 'tsconfig.base.json' }, { src: 'b', dest: 'tsconfig.json' }],
		devDependencies: { 'typescript': '5.9.3', '@types/node': '22' },
	}),
	unit('core-vitest', { category: 'test', label: 'Vitest', description: 'Unit tests.' }),
];

function view(over: Partial<PickerView> = {}): PickerView {
	return { message: 'What do you want?', width: 60, maxRows: 12, promptState: 'active', theme, ...over };
}

function state(installed: UnitId[] = []): PickerState {
	return createPickerState(UNITS, new Set(installed));
}

function typeFilter(s: PickerState, text: string): PickerState {
	return [...text].reduce((acc, char) => reducePicker(acc, { type: 'char', char }), s);
}

describe('renderUnitPicker', () => {
	it('renders a restrained default frame: one line per unit, no badges or summary yet', () => {
		expect(renderUnitPicker(state(), view())).toMatchInlineSnapshot(`
			"? What do you want?
			Foundationd{ 0/1}
			> [ ] a{EditorConfig}d{  Whitespace rules.}
			Lintingd{ 0/1}
			  [ ] ESLintd{ · base ▸}
			TypeScriptd{ 0/1}
			  [ ] TypeScript
			Testingd{ 0/1}
			  [ ] Vitest
			d{  ↑↓ move · space select · tab details · type to filter · ↵…}"
		`);
	});

	it('shows the filter line and collapses empty groups when filtering', () => {
		expect(renderUnitPicker(typeFilter(state(), 'esl'), view())).toMatchInlineSnapshot(`
			"? What do you want?
			d{  filter: esl}
			Lintingd{ 0/1}
			> [ ] a{ESLint}d{ · base ▸}d{  Lint JS and TS.}
			d{  ↑↓ move · space select · tab details · ←→ flavor · esc cl…}"
		`);
	});

	it('renders the expanded detail block under its row', () => {
		let s = reducePicker(state(), { type: 'move', delta: 2 }); // core-typescript
		s = reducePicker(s, { type: 'toggleExpand' });
		expect(renderUnitPicker(s, view())).toMatchInlineSnapshot(`
			"? What do you want?
			Foundationd{ 0/1}
			  [ ] EditorConfig
			Lintingd{ 0/1}
			  [ ] ESLintd{ · base ▸}
			TypeScriptd{ 0/1}
			> [ ] a{TypeScript}d{  Strict TS.}
			d{      files: tsconfig.base.json, tsconfig.json}
			d{      deps: typescript, @types/node}
			Testingd{ 0/1}
			  [ ] Vitest
			d{  ↑↓ move · space select · tab details · type to filter · ↵…}"
		`);
	});

	it('marks installed, auto, and flavor annotations, all dim', () => {
		let s = state(['core-editorconfig']); // editorconfig badged installed
		s = reducePicker(s, { type: 'move', delta: 1 }); // core-eslint active
		s = reducePicker(s, { type: 'toggle' }); // select eslint → typescript auto
		expect(renderUnitPicker(s, view())).toMatchInlineSnapshot(`
			"? What do you want?
			Foundationd{ 0/1}
			  [ ] EditorConfigd{ installed}
			Lintingd{ 1/1}
			> s{[x] }a{ESLint}d{ · base ▸}d{  Lint JS and TS.}
			TypeScriptd{ 0/1}
			  d{[~] }d{TypeScript}d{ auto — required by ESLint}
			Testingd{ 0/1}
			  [ ] Vitest
			d{  2 units · 2 files · 2 deps}
			d{  ↑↓ move · space select · tab details · ←→ flavor · type t…}"
		`);
	});

	it('adds a summary footer once something is selected', () => {
		let s = reducePicker(state(), { type: 'move', delta: 2 }); // core-typescript
		s = reducePicker(s, { type: 'toggle' });
		const out = renderUnitPicker(s, view());
		expect(out).toContain('units ·');
		expect(out).toMatchInlineSnapshot(`
			"? What do you want?
			Foundationd{ 0/1}
			  [ ] EditorConfig
			Lintingd{ 0/1}
			  [ ] ESLintd{ · base ▸}
			TypeScriptd{ 1/1}
			> s{[x] }a{TypeScript}d{  Strict TS.}
			Testingd{ 0/1}
			  [ ] Vitest
			d{  1 units · 2 files · 2 deps}
			d{  ↑↓ move · space select · tab details · type to filter · ↵…}"
		`);
	});

	it('shows a zero-match line when nothing matches', () => {
		const out = renderUnitPicker(typeFilter(state(), 'zzz'), view());
		expect(out).toContain('no matches');
		expect(out).toMatchInlineSnapshot(`
			"? What do you want?
			d{  filter: zzz}
			d{  no matches for "zzz"}
			d{  ↑↓ move · space select · tab details · esc clear · ↵ done}"
		`);
	});

	it('windows the body and marks clipped edges when it overflows maxRows', () => {
		let s = reducePicker(state(), { type: 'move', delta: 3 }); // core-vitest, near the end
		s = reducePicker(s, { type: 'move', delta: 0 });
		expect(renderUnitPicker(s, view({ maxRows: 5 }))).toMatchInlineSnapshot(`
			"? What do you want?
			d{  …}
			  [ ] TypeScript
			Testingd{ 0/1}
			> [ ] a{Vitest}d{  Unit tests.}
			d{  ↑↓ move · space select · tab details · type to filter · ↵…}"
		`);
	});

	it('truncates to width before styling, never slicing a style tag', () => {
		const out = renderUnitPicker(state(), view({ width: 22 }));
		// The tag-fake styles must stay balanced — a sliced ANSI code is the bug this guards.
		for (const line of out.split('\n')) {
			expect((line.match(/\{/g) ?? []).length).toBe((line.match(/\}/g) ?? []).length);
		}
		expect(out).toMatchInlineSnapshot(`
			"? What do you want?
			Foundationd{ 0/1}
			> [ ] a{EditorConfig}d{  W…}
			Lintingd{ 0/1}
			  [ ] ESLintd{ · base ▸}
			TypeScriptd{ 0/1}
			  [ ] TypeScript
			Testingd{ 0/1}
			  [ ] Vitest
			d{  ↑↓ move · space sel…}"
		`);
	});

	it('renders a compact one-liner on submit', () => {
		let s = reducePicker(state(), { type: 'move', delta: 2 });
		s = reducePicker(s, { type: 'toggle' });
		expect(renderUnitPicker(s, view({ promptState: 'submit' }))).toMatchInlineSnapshot(`"? What do you want? d{TypeScript}"`);
	});
});
