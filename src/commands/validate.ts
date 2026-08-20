import type { UnitIssue } from '../manifest/validate-unit';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { UNITS } from '../manifest/index';
import { UNIT_SCHEMA, validateUnitDefinition } from '../manifest/validate-unit';
import { EXIT_ERROR, EXIT_OK } from '../util/exit-codes';

// Bumps on breaking changes to the --json report envelope, independently of
// UNIT_SCHEMA: the report can gain a field without the unit contract moving.
export const VALIDATE_SCHEMA = 1;

// The manifest filename a unit directory is recognized by. Also the marker that
// separates "one unit" from "a directory of units" during path dispatch.
const MANIFEST = 'unit.json';

export interface ValidateEntry {
	path: string;
	id?: string;
	ok: boolean;
	issues: UnitIssue[];
}

export interface ValidateReport {
	schema: number;
	ok: boolean;
	units: ValidateEntry[];
}

export type ValidateOutcome
	= | { kind: 'report'; report: ValidateReport }
		| { kind: 'error'; message: string };

interface Candidate {
	// Absolute path to the definition document, for reading.
	file: string;
	// Where this unit's `src` paths resolve from. For a lone .json that is the
	// file's own directory, so a definition can sit beside its templates.
	baseDir: string;
}

// Built-in ids are always in scope: a local or packed unit may point `implies` at
// core-eslint, and it may not claim that id for itself.
const BUILTIN_IDS: ReadonlySet<string> = new Set(UNITS.map(u => u.id));

// Three shapes, distinguished by what is on disk rather than by a flag, so the
// same path a user passes to `validate` is the one #41's loader will walk:
// a lone .json is one definition, a directory with a unit.json is one unit, and
// anything else is treated as a directory of unit directories.
export function discover(target: string): Candidate[] | { error: string } {
	const abs = resolve(target);
	if (!existsSync(abs))
		return { error: `${target}: no such file or directory.` };

	if (!statSync(abs).isDirectory()) {
		if (!abs.endsWith('.json'))
			return { error: `${target}: expected a .json unit definition or a directory.` };
		return [{ file: abs, baseDir: dirname(abs) }];
	}

	const own = join(abs, MANIFEST);
	if (existsSync(own))
		return [{ file: own, baseDir: abs }];

	const children = readdirSync(abs, { withFileTypes: true })
		.filter(e => e.isDirectory())
		.map(e => join(abs, e.name, MANIFEST))
		.filter(file => existsSync(file))
		.sort();

	if (children.length === 0)
		return { error: `${target}: no ${MANIFEST} here or in any immediate subdirectory.` };

	return children.map(file => ({ file, baseDir: dirname(file) }));
}

export function validateTarget(target: string): ValidateOutcome {
	const found = discover(target);
	if ('error' in found)
		return { kind: 'error', message: found.error };

	// Parse everything before validating anything: relation checks need the whole
	// set's ids, so a unit implying its sibling passes in a units directory and
	// fails when that sibling isn't there.
	const parsed = found.map(c => ({ ...c, doc: readDefinition(c.file) }));
	const setIds = new Set<string>();
	for (const p of parsed) {
		const id = idOf(p.doc);
		if (id !== undefined)
			setIds.add(id);
	}
	const knownIds = new Set([...BUILTIN_IDS, ...setIds]);

	const seen = new Map<string, string>();
	const units: ValidateEntry[] = parsed.map(({ file, baseDir, doc }) => {
		const path = displayPath(file);
		if ('parseError' in doc) {
			return { path, ok: false, issues: [{ path: '(document)', expected: 'valid JSON', got: doc.parseError }] };
		}

		const result = validateUnitDefinition(doc.value, { baseDir, knownIds });
		const issues: UnitIssue[] = result.ok ? [] : [...result.issues];
		const id = idOf(doc);

		if (id !== undefined) {
			// A shadowed built-in would silently change what a recipe resolves to,
			// so it is an authoring error rather than an override mechanism.
			if (BUILTIN_IDS.has(id))
				issues.push({ path: 'id', expected: 'an id not already taken by a built-in unit', got: `"${id}"` });

			const first = seen.get(id);
			if (first !== undefined)
				issues.push({ path: 'id', expected: 'an id unique within this directory', got: `"${id}", already defined by ${first}` });
			else
				seen.set(id, path);
		}

		return { path, ...(id === undefined ? {} : { id }), ok: issues.length === 0, issues };
	});

	return {
		kind: 'report',
		report: { schema: VALIDATE_SCHEMA, ok: units.every(u => u.ok), units },
	};
}

export interface RunValidateOpts {
	json?: boolean;
}

export function runValidate(target: string, opts: RunValidateOpts = {}): number {
	const outcome = validateTarget(target);

	if (outcome.kind === 'error') {
		if (opts.json)
			process.stdout.write(`${JSON.stringify({ schema: VALIDATE_SCHEMA, ok: false, units: [] }, null, 2)}\n`);
		process.stderr.write(`${outcome.message}\n`);
		return EXIT_ERROR;
	}

	if (opts.json)
		process.stdout.write(`${JSON.stringify(outcome.report, null, 2)}\n`);
	else
		process.stdout.write(formatValidate(outcome.report));

	return outcome.report.ok ? EXIT_OK : EXIT_ERROR;
}

export function formatValidate(report: ValidateReport): string {
	const lines: string[] = [];
	const bad = report.units.filter(u => !u.ok);

	if (bad.length === 0) {
		const n = report.units.length;
		lines.push(`unbranded validate: ${n} unit definition${n === 1 ? '' : 's'} ok.`);
		return `${lines.join('\n')}\n`;
	}

	for (const unit of bad) {
		lines.push(`${unit.path}${unit.id === undefined ? '' : ` (${unit.id})`}:`);
		for (const issue of unit.issues) {
			lines.push(`  ${issue.path}: expected ${issue.expected} (got ${issue.got})`);
			// The upgrade path is the whole remedy here, and it isn't something the
			// author can fix by editing the file, so say so instead of leaving them
			// to read a version mismatch as a typo.
			if (issue.code === 'unsupported-schema')
				lines.push(`  ${' '.repeat(issue.path.length)}  a newer unbranded published this unit. Upgrade to use it.`);
		}
		lines.push('');
	}

	const total = bad.reduce((n, u) => n + u.issues.length, 0);
	lines.push(`${total} issue${total === 1 ? '' : 's'} in ${bad.length} of ${report.units.length} unit definition${report.units.length === 1 ? '' : 's'}.`);
	lines.push(`Unit schema ${UNIT_SCHEMA} is documented in docs/authoring-units.md.`);

	return `${lines.join('\n')}\n`;
}

// --- helpers ---

type Doc = { value: unknown } | { parseError: string };

// A definition outside the cwd relativizes to a ../../.. chain that reads worse
// than the absolute path, so relative wins only while it stays inside.
function displayPath(file: string): string {
	const rel = relative(process.cwd(), file);
	return rel !== '' && !rel.startsWith('..') ? rel : file;
}

function readDefinition(file: string): Doc {
	try {
		return { value: JSON.parse(readFileSync(file, 'utf-8')) };
	}
	catch (err) {
		return { parseError: err instanceof Error ? err.message : String(err) };
	}
}

function idOf(doc: Doc): string | undefined {
	if ('parseError' in doc)
		return undefined;
	const value = doc.value;
	if (typeof value !== 'object' || value === null)
		return undefined;
	const id = (value as { id?: unknown }).id;
	return typeof id === 'string' ? id : undefined;
}
