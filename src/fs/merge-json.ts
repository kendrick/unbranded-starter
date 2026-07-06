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

export function mergePackageJson(
	existing: Record<string, unknown>,
	patches: MergeInput[],
): Record<string, unknown> {
	const merged: Record<string, unknown> = { ...existing };

	for (const patch of patches) {
		if (patch.dependencies) {
			merged.dependencies = mergeDepLike(merged.dependencies, patch.dependencies);
		}
		if (patch.devDependencies) {
			merged.devDependencies = mergeDepLike(merged.devDependencies, patch.devDependencies);
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

function mergeDepLike(
	existing: unknown,
	addition: Record<string, string>,
): Record<string, string> {
	const base = isStringRecord(existing) ? existing : {};
	// Patch wins on key collision. Manifest versions are pinned by design;
	// the whole point of `unbranded` is that the CLI's version choices land.
	return { ...base, ...addition };
}

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
