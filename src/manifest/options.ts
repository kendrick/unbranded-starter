import type { Unit, UnitId, UnitOption } from './types';

// The option surface flattened for the config layer: which option a unit exposes
// (for the `id:value` inline syntax) and the allowed values per option key (for
// validating a recipe's `options` map). Built once from the manifest and passed
// into loadConfig/resolveConfig so config validation stays manifest-agnostic.
export interface OptionSchema {
	byUnit: Map<UnitId, UnitOption>;
	values: Map<string, Set<string>>;
}

export function buildOptionSchema(units: Unit[]): OptionSchema {
	const byUnit = new Map<UnitId, UnitOption>();
	const values = new Map<string, Set<string>>();
	for (const unit of units) {
		for (const option of unit.options ?? []) {
			byUnit.set(unit.id, option);
			values.set(option.key, new Set(option.choices.map(c => c.value)));
		}
	}
	return { byUnit, values };
}

// Resolve a unit's declared options against a set of chosen values, producing a
// concrete unit the rest of the pipeline can treat as any other. Each option's
// chosen choice overlays its effects: files append to the unit's static files,
// deps merge with the choice winning on a key collision. An unknown or missing
// selection falls back to the option's default, so a bad recipe value degrades to
// a safe build rather than an empty one. The `options` field is dropped from the
// result — a resolved unit has no more choices to make.
export function applyUnitOptions(unit: Unit, selections: Record<string, string>): Unit {
	if (!unit.options?.length)
		return unit;

	let files = unit.files;
	let dependencies = unit.dependencies;
	let devDependencies = unit.devDependencies;

	for (const option of unit.options) {
		const requested = selections[option.key];
		const choice = option.choices.find(c => c.value === requested)
			?? option.choices.find(c => c.value === option.default);
		if (!choice)
			continue;

		if (choice.files)
			files = [...files, ...choice.files];
		if (choice.dependencies)
			dependencies = { ...dependencies, ...choice.dependencies };
		if (choice.devDependencies)
			devDependencies = { ...devDependencies, ...choice.devDependencies };
	}

	const { options: _options, ...rest } = unit;
	return {
		...rest,
		files,
		...(dependencies ? { dependencies } : {}),
		...(devDependencies ? { devDependencies } : {}),
	};
}
