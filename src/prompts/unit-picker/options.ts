import type { FileOp, Unit, UnitId, UnitOption } from '../../manifest/types';
import { effectiveDest } from '../../detect/signals';
import { CATEGORY_LABELS, CATEGORY_ORDER } from '../../manifest/categories';

// The expandable detail for one unit (shown on Tab). Everything here is derived
// from the manifest, flattened so the renderer never reaches back into a raw Unit.
export interface PickerDetail {
	files: { dest: string; mode?: FileOp['mode'] }[];
	dependencies: Record<string, string>;
	devDependencies: Record<string, string>;
	// Implied units by their human label, not raw id, since the detail is read by a user.
	implies: string[];
	// The prompt text of each postInstall this unit would offer.
	postInstall: string[];
	// Set only for option-bearing units (core-eslint): its files and deps live in the
	// flavor choices, so the static block above is empty and this explains why.
	optionNote?: string;
}

// One selectable row in the picker. `installed`/`options`/`detail` are precomputed so
// the reducers and renderer stay pure string/data transforms over this, never over a Unit.
export interface PickerOption {
	value: UnitId;
	label: string;
	hint?: string;
	// Category display label — the group header this row sorts under.
	group: string;
	installed: boolean;
	// Carried verbatim for inline flavor cycling; absent on units with no variant axis.
	options?: UnitOption[];
	detail: PickerDetail;
}

// Category order, then declared order within a category — the same rule list.ts uses,
// so the picker, `list`, and `list --json` never disagree on ordering. Array.sort is
// stable on the Node versions we support, so equal-category units keep manifest order.
function orderUnits(units: Unit[]): Unit[] {
	return [...units].sort(
		(a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category),
	);
}

export function buildUnitPickerOptions(units: Unit[], installed: Set<UnitId>): PickerOption[] {
	const labelById = new Map(units.map(u => [u.id, u.label]));

	return orderUnits(units).map((unit) => {
		const detail: PickerDetail = {
			files: unit.files.map(f => ({ dest: effectiveDest(f), mode: f.mode })),
			dependencies: unit.dependencies ?? {},
			devDependencies: unit.devDependencies ?? {},
			// Fall back to the raw id if a label is missing, so a dangling implies edge
			// still shows something rather than "undefined".
			implies: (unit.implies ?? []).map(id => labelById.get(id) ?? id),
			postInstall: (unit.postInstall ?? []).map(p => p.prompt),
			...(unit.options?.length
				? { optionNote: `Files and dependencies vary by ${unit.options.map(o => o.label).join(', ')}.` }
				: {}),
		};

		return {
			value: unit.id,
			label: unit.label,
			...(unit.description ? { hint: unit.description } : {}),
			group: CATEGORY_LABELS[unit.category] ?? unit.category,
			installed: installed.has(unit.id),
			...(unit.options?.length ? { options: unit.options } : {}),
			detail,
		};
	});
}
