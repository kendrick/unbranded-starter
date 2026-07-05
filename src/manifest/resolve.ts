import type { Unit, UnitId } from './types';

export type ResolveResult
	= | { kind: 'ok'; ids: UnitId[]; auto: UnitId[]; requiredBy: Partial<Record<UnitId, UnitId>> }
		| { kind: 'missing-required'; unit: UnitId; needs: UnitId[] }
		| { kind: 'conflict'; pair: [UnitId, UnitId] };

// Closes the user's selection under `implies`, then validates `requires` and
// `excludes`. Returns either the resolved set (with separate visibility on
// which units got auto-added) or the first violation encountered.
//
// Pure — no prompting, no side effects. Caller decides how to surface errors.
export function resolveSelection(seed: UnitId[], units: Unit[]): ResolveResult {
	const byId = new Map<UnitId, Unit>(units.map(u => [u.id, u]));
	const seedSet = new Set(seed);
	const selected = new Set<UnitId>(seed);
	const auto = new Set<UnitId>();
	// Who pulled each auto-added unit in, so the plan can explain "(auto — required
	// by X)". Recorded at the add site, where the implying unit is in scope.
	const requiredBy: Partial<Record<UnitId, UnitId>> = {};

	// Fixed-point loop: `implies` is transitive (A → B → C), so one pass isn't
	// enough. Keep going until nothing new gets added.
	let changed = true;
	while (changed) {
		changed = false;
		for (const id of selected) {
			const unit = byId.get(id);
			if (!unit?.implies)
				continue;
			for (const implied of unit.implies) {
				if (!selected.has(implied)) {
					selected.add(implied);
					if (!seedSet.has(implied)) {
						auto.add(implied);
						// First writer wins, which resolves to the *nearest* requirer:
						// a Set visits mid-loop additions in insertion order, so when
						// A→B→C, C is reached while iterating B (not A) and gets B. The
						// `undefined` guard keeps that first attribution stable across a
						// later diamond edge. Seed units are skipped — the user picked
						// them, nothing "required" them.
						if (requiredBy[implied] === undefined)
							requiredBy[implied] = id;
					}
					changed = true;
				}
			}
		}
	}

	for (const id of selected) {
		const unit = byId.get(id);
		if (!unit?.requires)
			continue;
		const missing = unit.requires.filter(r => !selected.has(r));
		if (missing.length > 0) {
			return { kind: 'missing-required', unit: id, needs: missing };
		}
	}

	// Excludes is symmetric without needing both sides declared in the data.
	// We iterate over every selected unit, so if A→excludes→B is in the
	// manifest, the conflict surfaces when we visit A even if B's manifest
	// entry doesn't mention A.
	for (const id of selected) {
		const unit = byId.get(id);
		if (!unit?.excludes)
			continue;
		for (const x of unit.excludes) {
			if (selected.has(x)) {
				return { kind: 'conflict', pair: [id, x] };
			}
		}
	}

	return { kind: 'ok', ids: [...selected], auto: [...auto], requiredBy };
}
