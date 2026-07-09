import type { Pm } from '../detect/pm';
import type { OptionSchema } from '../manifest/options';
import type { UnitId } from '../manifest/types';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface Config {
	units: UnitId[];
	pm: Pm | null;
	onConflict: 'overwrite' | 'skip';
	postInstall: 'all' | 'none';
	// Unit-option selections keyed by option key (e.g. { eslintFlavor: 'react' }).
	// Applied by applyUnitOptions to resolve each unit to a concrete variant.
	// Optional — most units have no options, and an absent map means all defaults.
	options?: Record<string, string>;
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
export function loadConfig(path: string, knownUnits: Set<UnitId>, schema?: OptionSchema): Config {
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

	return validate(raw, knownUnits, schema);
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
//
// `unitsMode: 'additive'` is the preset twist: a preset is a starting point,
// so `--preset node-lib --units opt-vscode` extends the set instead of
// replacing it. Every other field keeps the flag-beats-file rule.
export function resolveConfig(
	fileConfig: Config | null,
	inline: InlineFlags,
	knownUnits: Set<UnitId>,
	schema?: OptionSchema,
	opts: { unitsMode?: 'override' | 'additive' } = {},
): Config {
	// Inline --units accepts an `id:value` suffix (e.g. core-eslint:react) that
	// picks a unit option inline. The id feeds the units array; the suffix, mapped
	// to the unit's option key via the schema, feeds the options map (inline
	// winning over any recipe options, mirroring how every inline flag beats the
	// recipe). Options given this way get validated by validate() below.
	const inlineOptions: Record<string, string> = {};
	let units: string[] | undefined;
	if (inline.units !== undefined) {
		units = [];
		for (const raw of inline.units.split(',')) {
			const token = raw.trim();
			if (!token)
				continue;
			const colon = token.indexOf(':');
			if (colon === -1) {
				units.push(token);
				continue;
			}
			const id = token.slice(0, colon).trim();
			const value = token.slice(colon + 1).trim();
			units.push(id);
			if (schema) {
				const option = schema.byUnit.get(id as UnitId);
				if (!option)
					throw new Error(`--units: ${id} takes no options, but ":${value}" was given.`);
				inlineOptions[option.key] = value;
			}
		}
	}
	else {
		units = fileConfig?.units;
	}
	if (opts.unitsMode === 'additive' && inline.units !== undefined && fileConfig?.units)
		units = [...new Set([...fileConfig.units, ...(units ?? [])])];

	const mergedOptions = { ...fileConfig?.options, ...inlineOptions };
	const options = Object.keys(mergedOptions).length > 0 ? mergedOptions : undefined;

	return validate({
		units,
		pm: inline.pm ?? fileConfig?.pm ?? null,
		onConflict: inline.onConflict ?? fileConfig?.onConflict ?? 'overwrite',
		postInstall: inline.postInstall ?? fileConfig?.postInstall ?? 'none',
		versions: fileConfig?.versions ?? 'pinned',
		projectName: fileConfig?.projectName,
		options,
		// Not an inline flag — there's no --git yet, so it only ever comes from the
		// recipe. Passing it through keeps `git: "init"` alive after the merge.
		git: fileConfig?.git,
		// Like git, force has no inline mirror: the --force flag rides its own
		// RunInitOpts channel, so the merge only has to keep the recipe field alive.
		force: fileConfig?.force,
	}, knownUnits, schema);
}

export function validate(raw: unknown, knownUnits: Set<UnitId>, schema?: OptionSchema): Config {
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

	const options = validateOptions(obj.options, schema);

	return {
		units: obj.units as UnitId[],
		pm: obj.pm as Pm | null,
		onConflict: obj.onConflict as 'overwrite' | 'skip',
		postInstall: obj.postInstall as 'all' | 'none',
		versions: (obj.versions as 'pinned' | 'latest') ?? 'pinned',
		projectName: obj.projectName as string | undefined,
		git: (obj.git as 'init' | 'init-commit' | 'none') ?? 'none',
		force: obj.force as boolean | undefined,
		...(options ? { options } : {}),
	};
}

// Shape-check the options map (an object of option-key → string), and when a
// schema is supplied, hold each key/value to the manifest's declared options.
// Failing loud here keeps a typo'd flavor from silently degrading to the default.
function validateOptions(raw: unknown, schema?: OptionSchema): Record<string, string> | undefined {
	if (raw === undefined)
		return undefined;
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
		throw new Error('config.options must be an object of option-key → value strings.');
	}
	const entries = Object.entries(raw as Record<string, unknown>);
	for (const [key, value] of entries) {
		if (typeof value !== 'string') {
			throw new TypeError(`config.options.${key} must be a string.`);
		}
		if (schema) {
			const allowed = schema.values.get(key);
			if (!allowed) {
				throw new Error(`config.options has unknown option "${key}". Run 'unbranded list' to see available options.`);
			}
			if (!allowed.has(value)) {
				throw new Error(`config.options.${key} must be one of: ${[...allowed].sort().join(', ')} (got "${value}").`);
			}
		}
	}
	return entries.length > 0 ? (raw as Record<string, string>) : undefined;
}
