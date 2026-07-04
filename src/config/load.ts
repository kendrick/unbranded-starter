import type { Pm } from '../detect/pm';
import type { UnitId } from '../manifest/types';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface Config {
	units: UnitId[];
	pm: Pm | null;
	onConflict: 'overwrite' | 'skip';
	postInstall: 'all' | 'none';
	// Pinned to the manifest's exact versions by default; 'latest' rewrites
	// every dependency to the `latest` dist-tag. The `--latest` flag overrides
	// this per run (flag wins over the recipe field).
	versions: 'pinned' | 'latest';
	// Only required when the target cwd has no package.json (new-project mode);
	// in augment mode the directory already exists and this is ignored.
	projectName?: string;
	// New-project mode only: 'init' runs `git init`, 'init-commit' also stages a
	// first commit, 'none' skips both. Defaults to 'none' so a scripted recipe
	// never creates a repo it wasn't asked to; the interactive flow prompts
	// instead (and defaults that prompt to yes).
	git: 'init' | 'init-commit' | 'none';
	// Skips the dirty-tree guard. A recipe committed to a repo that's clean by
	// construction (CI) sets this to drop the warning entirely; the --force flag
	// is the per-run equivalent. Optional so an ordinary recipe still gets the net.
	force?: boolean;
}

const VALID_PMS = new Set<string>(['npm', 'pnpm', 'yarn', 'bun']);
const VALID_ON_CONFLICT = new Set(['overwrite', 'skip']);
const VALID_POST_INSTALL = new Set(['all', 'none']);
const VALID_VERSIONS = new Set(['pinned', 'latest']);
const VALID_GIT = new Set(['init', 'init-commit', 'none']);

// v1 is JSON-only. YAML support is easy to add (we'd pull in `yaml` and key
// off the file extension) but isn't load-bearing for the E2E suite, which is
// what motivated this mode in the first place.
export function loadConfig(path: string, knownUnits: Set<UnitId>): Config {
	const abs = resolve(path);
	if (!existsSync(abs)) {
		throw new Error(`--config file not found: ${abs}`);
	}
	if (!/\.json$/i.test(abs)) {
		throw new Error(`--config currently supports .json only (got ${abs}).`);
	}

	let raw: unknown;
	try {
		raw = JSON.parse(readFileSync(abs, 'utf-8'));
	}
	catch (err) {
		throw new Error(`Invalid JSON in ${abs}: ${(err as Error).message}`);
	}

	return validate(raw, knownUnits);
}

// Shared so the recipe validator and the `--pm` flag apply one rule with one
// message. This is not a second validator: validate() calls it too, which is
// what keeps flag errors byte-identical to recipe errors.
export function assertValidPm(pm: unknown): asserts pm is Pm | null {
	if (pm !== null && (typeof pm !== 'string' || !VALID_PMS.has(pm))) {
		throw new Error(`config.pm must be one of: ${[...VALID_PMS].sort().join(', ')}, or null.`);
	}
}

// Inline CLI flags mirror the recipe fields one-for-one, kept as the raw strings
// argv hands us. `yes` isn't a recipe field; it only gates whether the caller
// skips the Apply confirm.
export interface InlineFlags {
	units?: string;
	pm?: string;
	onConflict?: string;
	postInstall?: string;
	yes?: boolean;
}

// Merge a `--config` recipe (if any) with inline flags, inline winning per
// field, then run the result through the same validate(). This mirrors how
// `--latest` overrides a recipe's `versions`: a flag beats the matching recipe
// field. Callers gate on having a units source before calling; if neither the
// recipe nor `--units` supplies one, validate() reports the missing array.
export function resolveConfig(fileConfig: Config | null, inline: InlineFlags, knownUnits: Set<UnitId>): Config {
	const units = inline.units !== undefined
		? inline.units.split(',').map(u => u.trim()).filter(Boolean)
		: fileConfig?.units;

	return validate({
		units,
		pm: inline.pm ?? fileConfig?.pm ?? null,
		onConflict: inline.onConflict ?? fileConfig?.onConflict ?? 'overwrite',
		postInstall: inline.postInstall ?? fileConfig?.postInstall ?? 'none',
		versions: fileConfig?.versions ?? 'pinned',
		projectName: fileConfig?.projectName,
		// Not an inline flag — there's no --git yet, so it only ever comes from the
		// recipe. Passing it through keeps `git: "init"` alive after the merge.
		git: fileConfig?.git,
		// Like git, force has no inline mirror: the --force flag rides its own
		// RunInitOpts channel, so the merge only has to keep the recipe field alive.
		force: fileConfig?.force,
	}, knownUnits);
}

export function validate(raw: unknown, knownUnits: Set<UnitId>): Config {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
		throw new Error('Config must be a JSON object.');
	}
	const obj = raw as Record<string, unknown>;

	if (!Array.isArray(obj.units)) {
		throw new TypeError('config.units must be an array of UnitId strings.');
	}
	const unknownUnits = obj.units.filter(
		u => typeof u !== 'string' || !knownUnits.has(u as UnitId),
	);
	if (unknownUnits.length > 0) {
		throw new Error(`config.units contains unknown ids: ${unknownUnits.join(', ')}. Run 'unbranded list' to see valid ids.`);
	}

	assertValidPm(obj.pm);

	if (typeof obj.onConflict !== 'string' || !VALID_ON_CONFLICT.has(obj.onConflict)) {
		throw new Error('config.onConflict must be "overwrite" or "skip".');
	}

	if (typeof obj.postInstall !== 'string' || !VALID_POST_INSTALL.has(obj.postInstall)) {
		throw new Error('config.postInstall must be "all" or "none".');
	}

	if (obj.versions !== undefined && (typeof obj.versions !== 'string' || !VALID_VERSIONS.has(obj.versions))) {
		throw new Error('config.versions must be "pinned" or "latest" when present.');
	}

	if (obj.projectName !== undefined && typeof obj.projectName !== 'string') {
		throw new Error('config.projectName must be a string when present.');
	}

	if (obj.git !== undefined && (typeof obj.git !== 'string' || !VALID_GIT.has(obj.git))) {
		throw new Error('config.git must be "init", "init-commit", or "none" when present.');
	}

	if (obj.force !== undefined && typeof obj.force !== 'boolean') {
		throw new TypeError('config.force must be a boolean when present.');
	}

	return {
		units: obj.units as UnitId[],
		pm: obj.pm as Pm | null,
		onConflict: obj.onConflict as 'overwrite' | 'skip',
		postInstall: obj.postInstall as 'all' | 'none',
		versions: (obj.versions as 'pinned' | 'latest') ?? 'pinned',
		projectName: obj.projectName as string | undefined,
		git: (obj.git as 'init' | 'init-commit' | 'none') ?? 'none',
		force: obj.force as boolean | undefined,
	};
}
