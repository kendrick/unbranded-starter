import type { Unit, UnitId } from '../../manifest/types';
import type { PickerOption } from './options';
import { applyUnitOptions } from '../../manifest/options';
import { resolveSelection } from '../../manifest/resolve';
import { buildUnitPickerOptions } from './options';

// The whole picker is a pure reducer over this state plus a translation table in the
// prompt shell. Keeping every rule here (not in the clack subclass) is what lets the
// behavior be unit-tested without a terminal.
export interface PickerState {
	// The manifest slice, kept so the implies preview can call the real resolver
	// rather than the picker re-deriving implies/requires/excludes closure itself.
	units: Unit[];
	// Full display model, ordered once at construction. Filtering is derived, never
	// destructive, so a filtered-out row keeps its selection.
	options: PickerOption[];
	filter: string;
	// Index into the FILTERED list, not `options`.
	cursor: number;
	// Explicit user picks, keyed by id so a selection survives any filter change.
	selected: Set<UnitId>;
	// Implied-in units (preview only), recomputed from the resolver on every toggle.
	auto: Set<UnitId>;
	requiredBy: Partial<Record<UnitId, UnitId>>;
	// At most one detail block open at a time.
	expanded: UnitId | null;
	// optionKey → chosen value (core-eslint's eslintFlavor today).
	flavors: Record<string, string>;
}

export type PickerEvent
	= | { type: 'move'; delta: number }
		| { type: 'char'; char: string }
		| { type: 'backspace' }
		| { type: 'clearFilter' }
		| { type: 'toggle' }
		| { type: 'toggleExpand' }
		| { type: 'cycleFlavor'; delta: number };

export type PickerRow
	= | { kind: 'header'; group: string; selected: number; total: number }
		| { kind: 'option'; option: PickerOption; selected: boolean; auto: boolean; requiredBy?: UnitId; active: boolean; flavor?: string }
		| { kind: 'detail'; option: PickerOption; flavor?: string };

export function createPickerState(
	units: Unit[],
	installed: Set<UnitId>,
	initialFlavors: Record<string, string> = {},
	initialSelected: UnitId[] = [],
): PickerState {
	const options = buildUnitPickerOptions(units, installed);
	const flavors: Record<string, string> = {};
	for (const opt of options) {
		for (const o of opt.options ?? [])
			flavors[o.key] = initialFlavors[o.key] ?? o.default;
	}
	// Seeds come from outside the picker (doctor --fix, presets), so filter to units
	// that actually exist — a phantom id would sit invisibly in the selection with no
	// row to toggle it off. The implies preview must reflect the seed on frame one,
	// the same way a manual toggle would.
	const known = new Set(units.map(u => u.id));
	const selected = new Set(initialSelected.filter(id => known.has(id)));
	return { units, options, filter: '', cursor: 0, selected, ...previewAuto(selected, units), expanded: null, flavors };
}

function matches(opt: PickerOption, filter: string): boolean {
	if (!filter)
		return true;
	const f = filter.toLowerCase();
	return opt.label.toLowerCase().includes(f) || opt.value.toLowerCase().includes(f) || opt.group.toLowerCase().includes(f);
}

export function filteredOptions(state: PickerState): PickerOption[] {
	return state.options.filter(o => matches(o, state.filter));
}

function clamp(n: number, lo: number, hi: number): number {
	return Math.min(hi, Math.max(lo, n));
}

// Filtering re-anchors the cursor to whatever row was highlighted so the selection
// doesn't appear to jump under the user; if that row filtered away, clamp into the
// shorter list. Any filter edit also collapses an open detail — the detail belongs to
// a row that may no longer be where the cursor lands.
function applyFilter(state: PickerState, filter: string): PickerState {
	const anchorId = filteredOptions(state)[state.cursor]?.value;
	const after = state.options.filter(o => matches(o, filter));
	let cursor = 0;
	if (anchorId !== undefined) {
		const idx = after.findIndex(o => o.value === anchorId);
		cursor = idx >= 0 ? idx : clamp(state.cursor, 0, Math.max(0, after.length - 1));
	}
	return { ...state, filter, cursor, expanded: null };
}

// The resolver is the single source of truth for "what does picking X drag in?".
// A non-ok selection (conflict/missing) has no clean auto set to preview; the real
// resolution in init.ts surfaces that error, so the preview just shows nothing.
function previewAuto(selected: Set<UnitId>, units: Unit[]): Pick<PickerState, 'auto' | 'requiredBy'> {
	const result = resolveSelection([...selected], units);
	if (result.kind === 'ok')
		return { auto: new Set(result.auto), requiredBy: result.requiredBy };
	return { auto: new Set<UnitId>(), requiredBy: {} };
}

export function reducePicker(state: PickerState, event: PickerEvent): PickerState {
	switch (event.type) {
		case 'move': {
			const filtered = filteredOptions(state);
			return { ...state, cursor: clamp(state.cursor + event.delta, 0, Math.max(0, filtered.length - 1)), expanded: null };
		}
		case 'char':
			return applyFilter(state, state.filter + event.char);
		case 'backspace':
			return applyFilter(state, state.filter.slice(0, -1));
		case 'clearFilter':
			return applyFilter(state, '');
		case 'toggle': {
			const opt = filteredOptions(state)[state.cursor];
			if (!opt)
				return state;
			const selected = new Set(state.selected);
			if (selected.has(opt.value))
				selected.delete(opt.value);
			else
				selected.add(opt.value);
			return { ...state, selected, ...previewAuto(selected, state.units) };
		}
		case 'toggleExpand': {
			const opt = filteredOptions(state)[state.cursor];
			if (!opt)
				return state;
			return { ...state, expanded: state.expanded === opt.value ? null : opt.value };
		}
		case 'cycleFlavor': {
			const option = filteredOptions(state)[state.cursor]?.options?.[0];
			if (!option)
				return state;
			const values = option.choices.map(c => c.value);
			const len = values.length;
			const cur = state.flavors[option.key] ?? option.default;
			const base = values.indexOf(cur);
			// Normalize into range so any delta sign wraps cleanly.
			const next = values[((((base < 0 ? 0 : base) + event.delta) % len) + len) % len] ?? cur;
			return { ...state, flavors: { ...state.flavors, [option.key]: next } };
		}
	}
}

// Counts for the summary footer, over the units that would actually be installed
// (explicit picks plus the implied preview). Flavors are baked in first via
// applyUnitOptions, so core-eslint's per-flavor files and deps count correctly rather
// than reading as zero — the same reason formatPlan counts against resolved units.
export function pickerSummary(state: PickerState): { units: number; files: number; deps: number } {
	const effective = new Set<UnitId>([...state.selected, ...state.auto]);
	const units = state.units.filter(u => effective.has(u.id)).map(u => applyUnitOptions(u, state.flavors));
	return {
		units: units.length,
		files: units.reduce((n, u) => n + u.files.length, 0),
		deps: units.reduce((n, u) => n + Object.keys(u.dependencies ?? {}).length + Object.keys(u.devDependencies ?? {}).length, 0),
	};
}

// Flattens the filtered options into display rows: a header per group (with its
// selected/total count), each option, and the expanded row's detail block spliced in
// right after it. Groups with no visible options never emit a header, so filtering
// collapses the tree cleanly.
export function pickerRows(state: PickerState): PickerRow[] {
	const filtered = filteredOptions(state);
	const activeId = filtered[state.cursor]?.value;
	const rows: PickerRow[] = [];
	let group: string | null = null;

	for (const opt of filtered) {
		if (opt.group !== group) {
			group = opt.group;
			const inGroup = filtered.filter(o => o.group === group);
			rows.push({
				kind: 'header',
				group,
				selected: inGroup.filter(o => state.selected.has(o.value)).length,
				total: inGroup.length,
			});
		}

		const flavor = opt.options?.[0] ? state.flavors[opt.options[0].key] : undefined;
		rows.push({
			kind: 'option',
			option: opt,
			selected: state.selected.has(opt.value),
			auto: state.auto.has(opt.value),
			requiredBy: state.requiredBy[opt.value],
			active: opt.value === activeId,
			flavor,
		});
		if (state.expanded === opt.value)
			rows.push({ kind: 'detail', option: opt, flavor });
	}

	return rows;
}
