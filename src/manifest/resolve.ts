import type { AnyUnit, ImpliesOneOf } from './types';
import { IMPLIES_ONE_OF } from './index';

export type ResolveResult =
	| { kind: 'ok'; ids: string[]; auto: string[]; requiredBy: Record<string, string> }
	| { kind: 'missing-required'; unit: string; needs: string[] }
	| { kind: 'conflict'; pair: [string, string] };

// Closes the user's selection under `implies` and `slots`, then validates
// `requires` and `excludes`. Returns either the resolved set (with separate
// visibility on which units got auto-added) or the first violation encountered.
//
// `present` is units the project already tracks. They satisfy a slot without
// joining the plan, so a project on core-eslint adding opt-ci-github doesn't get
// core-oxlint too. Only the slot check reads it: exclusions against tracked
// units are exclusionAgainstTracked's job.
//
// Pure — no prompting, no side effects. Caller decides how to surface errors.
export function resolveSelection(
	seed: string[],
	units: AnyUnit[],
	slots: readonly ImpliesOneOf[] = IMPLIES_ONE_OF,
	present: readonly string[] = [],
): ResolveResult {
	const byId = new Map<string, AnyUnit>(units.map((u) => [u.id, u]));
	const seedSet = new Set(seed);
	const selected = new Set<string>(seed);
	const auto = new Set<string>();
	// Who pulled each auto-added unit in, so the plan can explain "(auto — required
	// by X)". Recorded at the add site, where the implying unit is in scope.
	const requiredBy: Record<string, string> = {};

	function add(id: string, by: string): void {
		selected.add(id);
		if (seedSet.has(id)) return;
		auto.add(id);
		// First writer wins, which resolves to the *nearest* requirer: a Set visits
		// mid-loop additions in insertion order, so when A→B→C, C is reached while
		// iterating B (not A) and gets B. The `undefined` guard keeps that first
		// attribution stable across a later diamond edge. Seed units are skipped —
		// the user picked them, nothing "required" them.
		if (requiredBy[id] === undefined) requiredBy[id] = by;
	}

	function close(): void {
		// Fixed-point loop: `implies` is transitive (A → B → C), so one pass isn't
		// enough. Keep going until nothing new gets added.
		let changed = true;
		while (changed) {
			changed = false;
			for (const id of selected) {
				const unit = byId.get(id);
				if (!unit?.implies) continue;
				for (const implied of unit.implies) {
					if (!selected.has(implied)) {
						add(implied, id);
						changed = true;
					}
				}
			}
		}
	}
	close();

	// Slots fill after the implies closure, so a lint unit some other unit implies
	// satisfies opt-ci-github as well as one the user picked. A fill can imply more
	// (core-oxlint → core-typescript), so close again after each round.
	let filled = true;
	while (filled) {
		filled = false;
		for (const slot of slots) {
			// The `selected.has(fallback)` guard ends the loop even for a slot whose
			// fallback isn't in its own anyOf, which would otherwise refill forever.
			if (
				!selected.has(slot.unit) ||
				slot.anyOf.some((id) => selected.has(id) || present.includes(id)) ||
				!byId.has(slot.fallback) ||
				selected.has(slot.fallback)
			)
				continue;
			add(slot.fallback, slot.unit);
			filled = true;
		}
		if (filled) close();
	}

	for (const id of selected) {
		const unit = byId.get(id);
		if (!unit?.requires) continue;
		const missing = unit.requires.filter((r) => !selected.has(r));
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
		if (!unit?.excludes) continue;
		for (const x of unit.excludes) {
			if (selected.has(x)) {
				return { kind: 'conflict', pair: [id, x] };
			}
		}
	}

	return { kind: 'ok', ids: [...selected], auto: [...auto], requiredBy };
}

// The reverse question resolveSelection answers forward: which installed units
// would be stranded if `target` went away? A unit depends on the target when its
// own implies/requires closure reaches it — transitively, so removing the bottom
// of a chain names the whole chain. `unbranded remove` refuses with this list, or
// removes the closure under --cascade. Pure, like the resolver.
//
// Slots count too, but only against what's installed: a slot's unit is stranded
// when every installed anyOf member would go with the target. Without this,
// removing core-oxlint from an opt-ci-github project left ci.yml running a
// `pnpm lint` nothing defines, while a project that also tracks core-eslint can
// drop either lint unit safely.
export function dependentsOf(
	target: string,
	installed: string[],
	units: AnyUnit[],
	slots: readonly ImpliesOneOf[] = IMPLIES_ONE_OF,
): string[] {
	const byId = new Map<string, AnyUnit>(units.map((u) => [u.id, u]));
	const installedSet = new Set(installed);
	// `path` breaks implies cycles, which the catalog doesn't forbid. It's scoped to
	// the current path, not global: the slot check needs a true answer from every
	// member, and two members can share a node a global visited set would skip.
	function reaches(id: string, path: Set<string>): boolean {
		if (id === target) return true;
		if (path.has(id)) return false;
		path.add(id);
		const unit = byId.get(id);
		const edges = [...(unit?.implies ?? []), ...(unit?.requires ?? [])];
		const hit =
			edges.some((edge) => reaches(edge, path)) ||
			slots.some((slot) => {
				if (slot.unit !== id) return false;
				const members = slot.anyOf.filter((m) => installedSet.has(m));
				return members.length > 0 && members.every((m) => reaches(m, path));
			});
		path.delete(id);
		return hit;
	}
	return installed.filter((id) => id !== target && reaches(id, new Set()));
}

export interface TrackedExclusion {
	selected: string;
	tracked: string;
}

// resolveSelection only sees this run's picks. A unit already recorded in
// .unbranded.json still owns files and scripts, so an exclusion against it must
// fail like a within-selection one (#157). Both directions are checked without
// re-resolving the tracked set, because that could change what a plain add applies.
// Pure, like the resolver: the caller reads the state file.
export function exclusionAgainstTracked(
	selected: string[],
	tracked: string[],
	units: AnyUnit[],
): TrackedExclusion | undefined {
	const byId = new Map<string, AnyUnit>(units.map((u) => [u.id, u]));
	const others = tracked.filter((id) => !selected.includes(id));
	for (const id of selected) {
		const other = others.find(
			(t) => byId.get(id)?.excludes?.includes(t) || byId.get(t)?.excludes?.includes(id),
		);
		if (other !== undefined) return { selected: id, tracked: other };
	}
	return undefined;
}
