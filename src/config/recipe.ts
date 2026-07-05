import type { Pm } from '../detect/pm';
import type { UnitId } from '../manifest/types';
import type { Config } from './load';

// A saved recipe is a Config plus a provenance marker. `_generatedBy` isn't a
// Config field, so loadConfig's validate() ignores it on the way back in — it's
// there for the human reading the file, and it pins which CLI version wrote it.
export type Recipe = Config & { _generatedBy: string };

export interface RecipeInput {
	// The resolved selection, already closed under `implies`. Passing the closed
	// set (not the raw seed) is what makes a replay stable against future resolver
	// changes: the recipe records what actually got installed, not what was typed.
	ids: UnitId[];
	pm: Pm | null;
	// The active version policy for this run (`--latest` or a recipe's versions).
	latest: boolean;
	// New-project mode only; omitted in augment mode, where the dir already exists.
	projectName?: string;
	// The resolved unit-option selections (e.g. { eslintFlavor: 'react' }), so a
	// replay rebuilds the same flavor. Omitted from the recipe when empty.
	options?: Record<string, string>;
	// The running CLI version, stamped into `_generatedBy`.
	version: string;
}

// Pure. Turns the end-of-run state into a Config-shaped recipe. The caller owns
// the prompt and the file write; this just decides the shape so it stays testable.
export function buildRecipe(input: RecipeInput): Recipe {
	return {
		_generatedBy: `unbranded ${input.version}`,
		units: input.ids,
		pm: input.pm,
		// An interactive run has no single onConflict/postInstall value to record:
		// conflicts are answered per file and post-installs are prompted one at a
		// time. Rather than drop them, normalize to the policy a scripted replay
		// wants — overwrite existing files, run every post-install — so the recipe
		// reproduces the finished setup. Edit these by hand for skip/none.
		onConflict: 'overwrite',
		postInstall: 'all',
		versions: input.latest ? 'latest' : 'pinned',
		// git is the same un-capturable per-run decision; 'none' is the safe default
		// (and what augment runs did anyway). Flip it in the recipe to init a repo.
		git: 'none',
		...(input.projectName !== undefined ? { projectName: input.projectName } : {}),
		// Only record options when the run actually chose some, so a recipe for
		// option-free units stays as terse as before.
		...(input.options && Object.keys(input.options).length > 0 ? { options: input.options } : {}),
	};
}

// Mirror run.ts's package.json write: pretty-printed with two-space indent (its
// fallback for a fresh file) and one trailing newline, so a saved recipe reads
// like every other JSON artifact the tool emits.
export function serializeRecipe(recipe: Recipe): string {
	return `${JSON.stringify(recipe, null, 2)}\n`;
}
