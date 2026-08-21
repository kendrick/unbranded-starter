import type { AnyUnit, Category, FileOp, PostInstall, Unit, UnitOption, UnitSource } from '../manifest/types';
import { loadPreset, presetNames } from '../config/presets';
import { loadCatalog } from '../manifest/catalog';
import { CATEGORY_LABELS, CATEGORY_ORDER } from '../manifest/categories';
import { UNITS } from '../manifest/index';
import { resolveSelection } from '../manifest/resolve';
import { parseUnitRef } from '../manifest/unit-ref';

// Bump this when the JSON shape changes in a way that would break a consumer.
// Tooling keys off `schema` rather than sniffing for fields, so the envelope
// stays parseable across versions. 2 added the `presets` section (#38).
export const CATALOG_SCHEMA = 2;

// A FileOp with `src` removed. `src` anchors a path under PKG_ROOT — an
// internal detail of where we ship templates from — so it never crosses the
// public boundary. `dest`, `rename`, and `mode` describe what actually lands in
// the user's project, which is what a consumer cares about.
export interface CatalogFile {
	dest: string;
	rename?: string;
	mode?: FileOp['mode'];
}

// A UnitOption trimmed for the public catalog: the choice's baked-in `files`
// (a whole generated config) and `devDependencies` are an internal detail of how
// the flavor is applied, so only the selectable surface (value, label, hint)
// crosses the boundary.
export interface CatalogOptionChoice {
	value: string;
	label: string;
	hint?: string;
}

export interface CatalogOption {
	key: string;
	label: string;
	default: string;
	choices: CatalogOptionChoice[];
}

export interface CatalogUnit {
	id: string;
	category: Category;
	label: string;
	description: string;
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
	files: CatalogFile[];
	options?: CatalogOption[];
	implies?: string[];
	excludes?: string[];
	requires?: string[];
	postInstall?: PostInstall[];
	packageJsonPatch?: Unit['packageJsonPatch'];
	// Present only when the caller threads a sources map into buildCatalog — day-2
	// tooling and doctor's own buildCatalog() call don't pass one and keep working
	// unchanged. Reused verbatim from UnitSource so a --json consumer reads the same
	// shape schemas/state.schema.json already describes.
	source?: UnitSource;
}

// A shipped preset, expanded: `units` is the RESOLVED closure (implies edges
// walked), so a consumer sees what a `--preset` run would actually install
// rather than re-deriving the resolver's answer.
export interface CatalogPreset {
	name: string;
	description: string;
	units: string[];
}

export interface Catalog {
	schema: number;
	units: CatalogUnit[];
	presets: CatalogPreset[];
}

// Category display order, then declared order within a category. Array.sort is
// stable in the Node versions we support, so equal-category units keep their
// manifest order. This is the one place ordering is decided, so `list` and
// `list --json` agree with the interactive multiselect.
function orderUnits(units: AnyUnit[]): AnyUnit[] {
	return [...units].sort(
		(a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category),
	);
}

function toCatalogFile(file: FileOp): CatalogFile {
	const entry: CatalogFile = { dest: file.dest };
	if (file.rename)
		entry.rename = file.rename;
	if (file.mode)
		entry.mode = file.mode;
	return entry;
}

function toCatalogOption(option: UnitOption): CatalogOption {
	return {
		key: option.key,
		label: option.label,
		default: option.default,
		choices: option.choices.map(c => ({
			value: c.value,
			label: c.label,
			...(c.hint ? { hint: c.hint } : {}),
		})),
	};
}

// Explicit allowlist rather than a spread-minus-src, so the public contract is
// deliberate: a new internal field on Unit can't silently leak into the JSON.
// Optional keys are emitted only when present, which keeps each entry as terse
// as the manifest authored it.
function toCatalogUnit(unit: AnyUnit, source?: UnitSource): CatalogUnit {
	return {
		id: unit.id,
		category: unit.category,
		label: unit.label,
		description: unit.description,
		...(unit.dependencies ? { dependencies: unit.dependencies } : {}),
		...(unit.devDependencies ? { devDependencies: unit.devDependencies } : {}),
		files: unit.files.map(toCatalogFile),
		...(unit.options ? { options: unit.options.map(toCatalogOption) } : {}),
		...(unit.implies ? { implies: unit.implies } : {}),
		...(unit.excludes ? { excludes: unit.excludes } : {}),
		...(unit.requires ? { requires: unit.requires } : {}),
		...(unit.postInstall ? { postInstall: unit.postInstall } : {}),
		...(source ? { source } : {}),
		...(unit.packageJsonPatch ? { packageJsonPatch: unit.packageJsonPatch } : {}),
	};
}

// Pure builder, split from the printer so tests exercise the JSON shape without
// touching stdout. Defaults to the real manifest; takes an override for tests.
// `sources` is optional and separate from `units` (rather than folded into
// AnyUnit) because a unit's provenance is catalog metadata, not something a
// unit schema — built-in or authored — is allowed to carry; see catalog.ts.
export function buildCatalog(units: AnyUnit[] = UNITS, sources?: ReadonlyMap<string, UnitSource>): Catalog {
	return {
		schema: CATALOG_SCHEMA,
		units: orderUnits(units).map(u => toCatalogUnit(u, sources?.get(u.id))),
		presets: buildCatalogPresets(units),
	};
}

function buildCatalogPresets(units: AnyUnit[]): CatalogPreset[] {
	const known = new Set(units.map(u => u.id));
	return presetNames().map((name) => {
		const preset = loadPreset(name, known);
		const resolution = resolveSelection(preset.config.units, units);
		return {
			name,
			description: preset.description,
			units: resolution.kind === 'ok' ? [...resolution.ids].sort() : [...preset.config.units].sort(),
		};
	});
}

export function formatCatalog(units: AnyUnit[] = UNITS): string {
	const ordered = orderUnits(units);
	const idWidth = Math.max(...ordered.map(u => u.id.length));

	const lines: string[] = [];
	for (const category of CATEGORY_ORDER) {
		const inCategory = ordered.filter(u => u.category === category);
		if (inCategory.length === 0)
			continue;

		lines.push(CATEGORY_LABELS[category]);
		for (const unit of inCategory) {
			const implies = unit.implies?.length ? `  (implies → ${unit.implies.join(', ')})` : '';
			// A local unit's namespace is already baked into its own id (my-units/banner),
			// so it reads straight off parseUnitRef with no sources map to thread through —
			// this function keeps its UNITS-only default and doctor's buildCatalog() call
			// untouched. Appended last so it never disturbs the idWidth column alignment.
			const namespace = parseUnitRef(unit.id).namespace;
			const local = namespace !== undefined ? `  [local: ${namespace}]` : '';
			lines.push(`  ${unit.id.padEnd(idWidth)}  ${unit.label} — ${unit.description}${implies}${local}`);
			// A unit's options (core-eslint's flavor) get their own indented line so
			// the picker's choices are visible from `list` without running the CLI.
			for (const option of unit.options ?? []) {
				const values = option.choices.map(c => c.value).join(' | ');
				lines.push(`  ${' '.repeat(idWidth)}    ${option.key}: ${values}  (default: ${option.default})`);
			}
		}
		lines.push('');
	}

	lines.push('Presets (start points for --preset; --units adds to them)');
	for (const preset of buildCatalogPresets(ordered)) {
		lines.push(`  ${preset.name.padEnd(idWidth)}  ${preset.description}`);
		lines.push(`  ${' '.repeat(idWidth)}    → ${preset.units.join(', ')}`);
	}

	return `${lines.join('\n').trimEnd()}\n`;
}

// `list` is deliberately side-effect-free beyond stdout: no target detection,
// no prompts, no package.json. That's what lets it run anywhere, TTY or not.
export function runList(opts: { json?: boolean; unitsDir?: string } = {}): void {
	const catalog = loadCatalog({ unitsDirs: opts.unitsDir === undefined ? [] : [opts.unitsDir] });

	// A half-written units directory shouldn't hide the units that ARE fine, but
	// staying silent about the rest would leave the shorter catalog unexplained.
	// stderr only — --json consumers parse stdout and would choke on anything else
	// landing there, same reasoning as runDiff.
	for (const warning of catalog.warnings)
		process.stderr.write(`unbranded list: ${warning}\n`);
	for (const skip of catalog.skipped) {
		const detail = skip.issues.map(i => `${i.path}: expected ${i.expected}, got ${i.got}`).join('; ');
		process.stderr.write(`unbranded list: skipped ${skip.path}${skip.id ? ` (${skip.id})` : ''} — ${detail}\n`);
	}

	if (opts.json) {
		process.stdout.write(`${JSON.stringify(buildCatalog(catalog.units, catalog.sources), null, 2)}\n`);
		return;
	}
	process.stdout.write(formatCatalog(catalog.units));
}
