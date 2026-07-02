import type { Category, FileOp, PostInstall, Unit, UnitId } from '../manifest/types';
import { CATEGORY_LABELS, CATEGORY_ORDER } from '../manifest/categories';
import { UNITS } from '../manifest/index';

// Bump this when the JSON shape changes in a way that would break a consumer.
// Tooling keys off `schema` rather than sniffing for fields, so the envelope
// stays parseable across versions.
export const CATALOG_SCHEMA = 1;

// A FileOp with `src` removed. `src` anchors a path under PKG_ROOT — an
// internal detail of where we ship templates from — so it never crosses the
// public boundary. `dest`, `rename`, and `mode` describe what actually lands in
// the user's project, which is what a consumer cares about.
export interface CatalogFile {
	dest: string;
	rename?: string;
	mode?: FileOp['mode'];
}

export interface CatalogUnit {
	id: UnitId;
	category: Category;
	label: string;
	description: string;
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
	files: CatalogFile[];
	implies?: UnitId[];
	excludes?: UnitId[];
	requires?: UnitId[];
	postInstall?: PostInstall[];
	packageJsonPatch?: Unit['packageJsonPatch'];
}

export interface Catalog {
	schema: number;
	units: CatalogUnit[];
}

// Category display order, then declared order within a category. Array.sort is
// stable in the Node versions we support, so equal-category units keep their
// manifest order. This is the one place ordering is decided, so `list` and
// `list --json` agree with the interactive multiselect.
function orderUnits(units: Unit[]): Unit[] {
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

// Explicit allowlist rather than a spread-minus-src, so the public contract is
// deliberate: a new internal field on Unit can't silently leak into the JSON.
// Optional keys are emitted only when present, which keeps each entry as terse
// as the manifest authored it.
function toCatalogUnit(unit: Unit): CatalogUnit {
	return {
		id: unit.id,
		category: unit.category,
		label: unit.label,
		description: unit.description,
		...(unit.dependencies ? { dependencies: unit.dependencies } : {}),
		...(unit.devDependencies ? { devDependencies: unit.devDependencies } : {}),
		files: unit.files.map(toCatalogFile),
		...(unit.implies ? { implies: unit.implies } : {}),
		...(unit.excludes ? { excludes: unit.excludes } : {}),
		...(unit.requires ? { requires: unit.requires } : {}),
		...(unit.postInstall ? { postInstall: unit.postInstall } : {}),
		...(unit.packageJsonPatch ? { packageJsonPatch: unit.packageJsonPatch } : {}),
	};
}

// Pure builder, split from the printer so tests exercise the JSON shape without
// touching stdout. Defaults to the real manifest; takes an override for tests.
export function buildCatalog(units: Unit[] = UNITS): Catalog {
	return {
		schema: CATALOG_SCHEMA,
		units: orderUnits(units).map(toCatalogUnit),
	};
}

export function formatCatalog(units: Unit[] = UNITS): string {
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
			lines.push(`  ${unit.id.padEnd(idWidth)}  ${unit.label} — ${unit.description}${implies}`);
		}
		lines.push('');
	}

	return `${lines.join('\n').trimEnd()}\n`;
}

// `list` is deliberately side-effect-free beyond stdout: no target detection,
// no prompts, no package.json. That's what lets it run anywhere, TTY or not.
export function runList(opts: { json?: boolean } = {}): void {
	if (opts.json) {
		process.stdout.write(`${JSON.stringify(buildCatalog(), null, 2)}\n`);
		return;
	}
	process.stdout.write(formatCatalog());
}
