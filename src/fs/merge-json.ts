export interface MergeInput {
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
	scripts?: Record<string, string>;
	engines?: Record<string, string>;
	// Corepack's pin, e.g. 'pnpm@10.0.0'. A top-level scalar rather than a map,
	// so it gets its own existing-wins merge instead of the dep/script treatment.
	packageManager?: string;
}

// Top-level keys in the order antfu's shipped config expects. This mirrors
// @antfu/eslint-config's `sortPackageJson` list verbatim so a scaffolded
// package.json satisfies `jsonc/sort-keys` with no `lint:fix` pass (#48). The
// order has quirks worth not "fixing": `type` sits ahead of `version`, and
// `private`/`packageManager` ahead of `description`. Anything not listed is
// appended in its original order so unknown fields stay where the user put them.
const TOP_LEVEL_ORDER = [
	'publisher',
	'name',
	'displayName',
	'type',
	'version',
	'private',
	'packageManager',
	'description',
	'author',
	'contributors',
	'license',
	'funding',
	'homepage',
	'repository',
	'bugs',
	'keywords',
	'categories',
	'sideEffects',
	'imports',
	'exports',
	'main',
	'module',
	'unpkg',
	'jsdelivr',
	'types',
	'typesVersions',
	'bin',
	'icon',
	'files',
	'engines',
	'activationEvents',
	'contributes',
	'scripts',
	'peerDependencies',
	'peerDependenciesMeta',
	'dependencies',
	'optionalDependencies',
	'devDependencies',
	'pnpm',
	'overrides',
	'resolutions',
	'husky',
	'simple-git-hooks',
	'lint-staged',
	'eslintConfig',
];

// Nested maps we sort alphabetically. The goal is reproducible diffs across
// runs: today npm and pnpm both alphabetize on `install`, but we don't want
// to depend on that — we do it ourselves before any tool gets to.
const ALPHABETIZE_NESTED = new Set([
	'scripts',
	'dependencies',
	'devDependencies',
	'peerDependencies',
	'optionalDependencies',
	'engines',
]);

// The two dependency sections, kept as a literal tuple (rather than derived
// from MergeInput's keys) so collectDepCollisions and mergePackageJson can
// both iterate it and agree on order.
const DEP_SECTIONS = ['dependencies', 'devDependencies'] as const;

export type DepSection = typeof DEP_SECTIONS[number];

export interface DepCollision {
	section: DepSection;
	name: string;
	existing: string; // the spec already in the user's package.json
	incoming: string; // the spec the patches would land (last patch wins)
}

export function depKey(c: Pick<DepCollision, 'section' | 'name'>): string {
	return `${c.section}:${c.name}`;
}

// Pure detection pass, separate from the merge itself, so a caller can ask
// "what would change and clash" before committing to a resolution—the
// merge alone can't answer that without silently picking manifest-wins.
export function collectDepCollisions(
	existing: Record<string, unknown>,
	patches: MergeInput[],
): DepCollision[] {
	const collisions: DepCollision[] = [];

	for (const section of DEP_SECTIONS) {
		const existingSection = isStringRecord(existing[section]) ? existing[section] : {};

		// Same last-patch-wins fold mergePackageJson uses below. If this fold
		// order ever drifts from the merge's, detection and the merge disagree
		// about what "incoming" even means.
		const incoming: Record<string, string> = {};
		for (const patch of patches) {
			const patchSection = patch[section];
			if (patchSection)
				Object.assign(incoming, patchSection);
		}

		for (const name of Object.keys(incoming).sort()) {
			const existingSpec = existingSection[name];
			const incomingSpec = incoming[name]!;
			// Equal specs aren't collisions: re-running the same recipe would
			// otherwise re-prompt and re-report every pin that hasn't actually
			// moved.
			if (existingSpec !== undefined && existingSpec !== incomingSpec) {
				collisions.push({ section, name, existing: existingSpec, incoming: incomingSpec });
			}
		}
	}

	return collisions;
}

export function mergePackageJson(
	existing: Record<string, unknown>,
	patches: MergeInput[],
	keepExisting?: ReadonlySet<string>,
): Record<string, unknown> {
	const merged: Record<string, unknown> = { ...existing };

	for (const patch of patches) {
		if (patch.dependencies) {
			merged.dependencies = mergeDepLike(merged.dependencies, patch.dependencies, 'dependencies', keepExisting);
		}
		if (patch.devDependencies) {
			merged.devDependencies = mergeDepLike(merged.devDependencies, patch.devDependencies, 'devDependencies', keepExisting);
		}
		if (patch.scripts) {
			// Additive only. The user may already have a `lint` or `test` script
			// pointing at their own logic; we don't second-guess them.
			merged.scripts = mergeAdditive(merged.scripts, patch.scripts);
		}
		if (patch.engines) {
			// Same treatment: existing constraints win. If the user has pinned
			// node 22 and a unit wants >=20, we leave 22 in place.
			merged.engines = mergeAdditive(merged.engines, patch.engines);
		}
		if (patch.packageManager && !merged.packageManager) {
			// Existing wins: a user who pinned yarn keeps it even if we detected
			// pnpm running. We only fill the field in when it's genuinely absent.
			merged.packageManager = patch.packageManager;
		}
	}

	return sortPackageJson(merged);
}

// What `unbranded remove` strips from package.json after reference-counting.
// Dependencies are identified by name alone — version drift (renovate, a user
// bump) doesn't change what the entry is. Scripts carry the value the unit
// contributed, and are only removed while they still say exactly that: a script
// the user rewrote is their work now, so it stays and gets reported.
export interface PackageJsonRemoval {
	dependencies?: string[];
	devDependencies?: string[];
	scripts?: Record<string, string>;
}

export function removePackageJsonEntries(
	existing: Record<string, unknown>,
	removal: PackageJsonRemoval,
): { pkg: Record<string, unknown>; keptScripts: string[] } {
	const pkg: Record<string, unknown> = { ...existing };
	const keptScripts: string[] = [];

	for (const section of ['dependencies', 'devDependencies'] as const) {
		const names = removal[section];
		if (!names || !isStringRecord(pkg[section]))
			continue;
		const map = { ...pkg[section] as Record<string, string> };
		for (const name of names)
			delete map[name];
		setOrDrop(pkg, section, map);
	}

	if (removal.scripts && isStringRecord(pkg.scripts)) {
		const map = { ...pkg.scripts };
		for (const [name, expected] of Object.entries(removal.scripts)) {
			if (!(name in map))
				continue;
			if (map[name] === expected)
				delete map[name];
			else
				keptScripts.push(name);
		}
		setOrDrop(pkg, 'scripts', map);
	}

	return { pkg: sortPackageJson(pkg), keptScripts };
}

// A section we emptied disappears entirely — a dangling `"devDependencies": {}`
// is exactly the kind of residue remove exists to not leave behind.
function setOrDrop(pkg: Record<string, unknown>, key: string, map: Record<string, string>): void {
	if (Object.keys(map).length === 0)
		delete pkg[key];
	else
		pkg[key] = map;
}

// Manifest-wins is the default here, not because deps are less the user's
// than scripts or engines, but because a version pin isn't standalone—the
// unit tested and shipped its dependencies as a set, so overwriting is the
// only default that keeps that set coherent. Unlike mergeAdditive below,
// this isn't the end of the story: collectDepCollisions surfaces every case
// where the default would move a spec, and a caller can override any one
// entry through `keepExisting` without disturbing its siblings.
function mergeDepLike(
	existing: unknown,
	addition: Record<string, string>,
	section: DepSection,
	keepExisting: ReadonlySet<string> | undefined,
): Record<string, string> {
	const base = isStringRecord(existing) ? existing : {};
	const result: Record<string, string> = { ...base };
	for (const [name, spec] of Object.entries(addition)) {
		// Keeping one dep must never touch its siblings, and `addition` isn't
		// ours to touch either—in the real caller it aliases the unit
		// catalog's own dependency object, so we build the result entry by
		// entry instead of filtering or mutating `addition` directly.
		if (keepExisting?.has(depKey({ section, name })) && name in base)
			continue;
		result[name] = spec;
	}
	return result;
}

// Existing-wins here, opposite of mergeDepLike above, because scripts and
// engines aren't version coordinates a manifest curates as a group—they're
// the user's own logic (a custom `lint` script, a node floor they chose), so
// there's nothing for us to second-guess and nothing to report.
function mergeAdditive(
	existing: unknown,
	addition: Record<string, string>,
): Record<string, string> {
	const base = isStringRecord(existing) ? existing : {};
	const newOnly = Object.fromEntries(
		Object.entries(addition).filter(([key]) => !(key in base)),
	);
	return { ...base, ...newOnly };
}

function isStringRecord(value: unknown): value is Record<string, string> {
	if (!value || typeof value !== 'object' || Array.isArray(value))
		return false;
	return Object.values(value).every(v => typeof v === 'string');
}

function sortPackageJson(pkg: Record<string, unknown>): Record<string, unknown> {
	const sorted: Record<string, unknown> = {};
	for (const key of TOP_LEVEL_ORDER) {
		if (key in pkg)
			sorted[key] = sortNested(key, pkg[key]);
	}
	for (const key of Object.keys(pkg)) {
		if (!(key in sorted))
			sorted[key] = pkg[key];
	}
	return sorted;
}

function sortNested(parentKey: string, value: unknown): unknown {
	if (!ALPHABETIZE_NESTED.has(parentKey))
		return value;
	if (!value || typeof value !== 'object' || Array.isArray(value))
		return value;
	const obj = value as Record<string, unknown>;
	const result: Record<string, unknown> = {};
	for (const key of Object.keys(obj).sort()) result[key] = obj[key];
	return result;
}
