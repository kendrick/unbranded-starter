import type { Unit } from '../manifest/types';

// opt-vscode's extensions.json can't ship as a static template: its recommended
// set has to reflect which units the user actually selected. run.ts recognizes
// this id and materializes the file from buildRecommendations, mirroring how
// core-node-version computes .nvmrc/engines from the environment.
export const VSCODE_UNIT_ID = 'opt-vscode';

// Pure so it's unit-tested without touching disk. `existing` carries whatever
// the user already had in .vscode/extensions.json's `recommendations`, so a
// rerun (or a hand-maintained file) keeps their entries and only folds ours in.
export function buildRecommendations(units: Unit[], existing: readonly string[] = []): string[] {
	// Existing entries keep the user's order — same politeness merge-json gives a
	// settings.json — deduped in case their file already carried repeats.
	const seen = new Set<string>();
	const result: string[] = [];
	for (const id of existing) {
		if (!seen.has(id)) {
			seen.add(id);
			result.push(id);
		}
	}

	const ours = new Set<string>();
	for (const unit of units) {
		for (const id of unit.recommendedExtensions ?? [])
			ours.add(id);
	}

	// Our additions land sorted after the user's entries, so a from-scratch file
	// is deterministic rather than following manifest declaration order.
	const additions = [...ours].filter(id => !seen.has(id)).sort();
	return [...result, ...additions];
}
