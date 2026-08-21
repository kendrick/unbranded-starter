import type { SkippedUnit } from './load-units';
import type { OptionSchema } from './options';
import type { AnyUnit, UnitSource } from './types';
import { resolve } from 'node:path';
import { PKG_ROOT } from '../util/paths';
import { UNITS } from './index';
import { loadUnitsDir } from './load-units';
import { buildOptionSchema } from './options';

export interface Catalog {
	// Built-ins first, then locals — the order list.ts and the interactive
	// prompt render units in, unchanged from today's built-ins-only ordering.
	units: AnyUnit[];
	ids: ReadonlySet<string>;
	builtinIds: ReadonlySet<string>;
	sources: ReadonlyMap<string, UnitSource>;
	templateRoots: ReadonlyMap<string, string>;
	optionSchema: OptionSchema;
	skipped: SkippedUnit[];
	warnings: string[];
}

export interface LoadCatalogOpts {
	// Resolved to absolute paths by the caller — whether a relative value means
	// "relative to cwd" or "relative to a recipe file" is the caller's decision,
	// not this one's. Resolved defensively anyway so an absolute path is a no-op.
	//
	// A list rather than a single directory because the day-2 commands rebuild this
	// from the state file, and a project scaffolded twice from two directories has
	// both recorded. Taking only the first would make `remove` silently unable to
	// find half its units.
	unitsDirs?: string[];
	// 'warn' for the day-2 commands, which rebuild from paths a past run recorded:
	// the directory may have moved or been deleted since, and refusing to run would
	// leave the user unable to `remove` the very units they can no longer load.
	// 'throw' (the default) for a directory the user just named on the command line,
	// where a typo should be an error rather than a quietly shorter catalog.
	onMissing?: 'throw' | 'warn';
}

export function loadCatalog(opts: LoadCatalogOpts = {}): Catalog {
	const builtinIds = new Set(UNITS.map(u => u.id));

	// `source` lives in this map and never as a field on a unit object: the e2e
	// contract test validates every built-in unit against the published
	// schemas/unit.schema.json, which rejects unknown keys, so welding
	// provenance onto the Unit itself would fail that check the moment a
	// built-in round-tripped through this function. Keeping it out-of-band also
	// means the UNITS singletons never get mutated — two loadCatalog() calls in
	// the same process can't leak state into each other through a shared object.
	const sources = new Map<string, UnitSource>();
	const templateRoots = new Map<string, string>();
	for (const unit of UNITS) {
		sources.set(unit.id, { kind: 'builtin' });
		templateRoots.set(unit.id, PKG_ROOT);
	}

	let units: AnyUnit[] = [...UNITS];
	let skipped: SkippedUnit[] = [];
	let warnings: string[] = [];

	const namespaces = new Map<string, string>();
	for (const dir of dedupe(opts.unitsDirs ?? [])) {
		const absDir = resolve(dir);
		let loaded;
		try {
			loaded = loadUnitsDir(absDir, builtinIds);
		}
		catch (err) {
			if (opts.onMissing !== 'warn')
				throw err;
			// discover() already names the path in its own errors, so don't say it twice.
			warnings.push(`Could not load units: ${(err as Error).message}`);
			continue;
		}

		// Two directories sharing a basename would produce one namespace covering
		// both, so `my-units/banner` would name two different units. Refusing the
		// second is the only answer that keeps a reference meaning one thing.
		const claimed = namespaces.get(loaded.namespace);
		if (claimed !== undefined) {
			warnings.push(`Skipped ${absDir}: its namespace "${loaded.namespace}" is already taken by ${claimed}.`);
			continue;
		}
		namespaces.set(loaded.namespace, absDir);

		units = [...units, ...loaded.units];
		skipped = [...skipped, ...loaded.skipped];
		warnings = [...warnings, ...loaded.warnings];
		for (const unit of loaded.units) {
			sources.set(unit.id, { kind: 'dir', path: absDir });
			// loadUnitsDir guarantees an entry for every unit it returns — see
			// LoadedUnitsDir's baseDirs contract.
			templateRoots.set(unit.id, loaded.baseDirs.get(unit.id)!);
		}
	}

	return {
		units,
		ids: new Set(units.map(u => u.id)),
		builtinIds,
		sources,
		templateRoots,
		optionSchema: buildOptionSchema(units),
		skipped,
		warnings,
	};
}

// The day-2 commands rebuild the catalog from what a scaffold recorded, so an
// override has to replace the recorded set wholesale rather than join it: a user
// passing --units-dir is saying the directory moved, and loading both the old path
// and the new one would either fail on the missing one or namespace-collide.
export function unitsDirsFor(recorded: Iterable<UnitSource>, targetDir: string, override?: string): string[] {
	if (override !== undefined)
		return [override];
	const dirs: string[] = [];
	for (const source of recorded) {
		if (source.kind === 'dir')
			dirs.push(resolve(targetDir, source.path));
	}
	return dedupe(dirs);
}

function dedupe(values: string[]): string[] {
	return [...new Set(values.map(v => resolve(v)))];
}
