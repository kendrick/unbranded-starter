import type { FileOp, UnitDefinition } from './types';
import { existsSync } from 'node:fs';
import { join, posix } from 'node:path';
import { checkContainment } from '../fs/contain';

// The published contract's version. UNIT_SCHEMA_MIN stays separate from
// UNIT_SCHEMA (both 1 today) because a future breaking bump will want to keep
// reading older definitions for a while rather than cutting them off the day
// the max moves—the two only diverge once that grace window exists.
export const UNIT_SCHEMA = 1;
export const UNIT_SCHEMA_MIN = 1;

export interface UnitIssue {
	path: string;
	expected: string;
	got: string;
	code?: 'unsupported-schema';
}

export type UnitValidationResult
	= | { ok: true; unit: UnitDefinition }
		| { ok: false; issues: UnitIssue[] };

// Hand-rolled against schemas/unit.schema.json rather than run through ajv: ajv
// is a devDependency only (the schema file is the published contract for docs
// and external tooling, not a runtime dependency), so a unit author's mistake
// gets caught by the same code the CLI ships, with no JSON-Schema engine
// riding along. Every branch mirrors a clause of that schema; keep the two in
// sync by hand when either changes.
//
// Unlike config/load.ts's validate() (which throws on the first bad field),
// this accumulates every issue in one pass—a unit author fixing a typo'd
// definition wants the whole list, not one round-trip per mistake.
const CATEGORIES = ['foundation', 'lint', 'style', 'types', 'test', 'e2e', 'monorepo', 'ui', 'git', 'editor', 'ci'] as const;
const FILE_MODES = ['copy', 'merge-json', 'append-if-missing'] as const;

const TOP_LEVEL_KEYS = new Set([
	'schema',
	'id',
	'category',
	'label',
	'description',
	'dependencies',
	'devDependencies',
	'files',
	'options',
	'recommendedExtensions',
	'implies',
	'excludes',
	'requires',
	'postInstall',
	'packageJsonPatch',
	'removeNotes',
]);
const FILE_KEYS = new Set(['src', 'content', 'dest', 'rename', 'mode']);
const OPTION_KEYS = new Set(['key', 'label', 'default', 'choices']);
const OPTION_CHOICE_KEYS = new Set(['value', 'label', 'hint', 'files', 'dependencies', 'devDependencies']);
const POST_INSTALL_KEYS = new Set(['id', 'command', 'prompt', 'default', 'requires']);
const PACKAGE_JSON_PATCH_KEYS = new Set(['scripts', 'engines', 'packageManager']);

const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
// Exact pins only—a range would make two runs of the same unit produce
// different trees, which is the reproducibility guarantee this mirrors from
// unit.schema.json's pinnedDeps $def.
const PIN_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Z-.]+)?(?:\+[0-9A-Z-.]+)?$/i;

// A synthetic, always-absolute root for the containment guard below.
// `validate <path>` takes no `--target`, so no real project root exists at
// validation time — the property being checked is root-agnostic (rejected
// when resolved against ANY root, it would land outside it), and resolving
// against a fixed notional root is the equivalent, checkable form of that.
// It must never be `process.cwd()`: a guard that captured the process's
// working directory would accept or reject the same unit differently
// depending on where the binary was invoked from, which no test run from a
// single directory can see. This string resolves identically under both
// path.posix and path.win32 regardless of the host's cwd or drive.
const CONTAINMENT_ROOT = '/__unbranded_containment_root__';

export function validateUnitDefinition(
	value: unknown,
	opts: { baseDir?: string; knownIds?: ReadonlySet<string> } = {},
): UnitValidationResult {
	const issues: UnitIssue[] = [];

	if (!isPlainObject(value)) {
		issues.push({ path: '(root)', expected: 'an object', got: typeOf(value) });
		return { ok: false, issues };
	}

	validateSchemaVersion(value, issues);
	validateStructure(value, issues);
	// Unconditional, unlike the two passes below: an escaping `dest`/`rename`
	// is a vulnerability regardless of whether the caller also happens to pass
	// baseDir or knownIds, and validateUnitDefinition is the one entry point
	// every route into the catalog already passes through.
	validateContainment(value, issues);
	// baseDir and knownIds are opt-in: a caller checking a definition that was
	// never read off disk (e.g. one assembled in memory) has neither a
	// directory to resolve `src` against nor a catalog to check relations
	// against, and both passes would otherwise need a sentinel to skip.
	if (opts.baseDir !== undefined)
		validateFileSources(value, opts.baseDir, issues);
	if (opts.knownIds !== undefined)
		validateRelations(value, opts.knownIds, issues);

	if (issues.length > 0)
		return { ok: false, issues };
	return { ok: true, unit: value as unknown as UnitDefinition };
}

function validateSchemaVersion(obj: Record<string, unknown>, issues: UnitIssue[]): void {
	const schema = obj.schema;
	if (typeof schema !== 'number' || !Number.isInteger(schema)) {
		issues.push({ path: 'schema', expected: 'an integer', got: typeOf(schema) });
		return;
	}
	// The `expected` string is shared between the two out-of-range branches so
	// a caller can render one upgrade hint regardless of which side failed;
	// only "too new" gets the `unsupported-schema` code, since that's the one
	// case where the fix is "upgrade unbranded" rather than "fix the file".
	const range = `unit schema ${UNIT_SCHEMA_MIN} through ${UNIT_SCHEMA}`;
	if (schema > UNIT_SCHEMA) {
		issues.push({ path: 'schema', expected: range, got: String(schema), code: 'unsupported-schema' });
	}
	else if (schema < UNIT_SCHEMA_MIN) {
		issues.push({ path: 'schema', expected: range, got: String(schema) });
	}
}

function validateStructure(obj: Record<string, unknown>, issues: UnitIssue[]): void {
	checkAdditionalProps(obj, '', TOP_LEVEL_KEYS, issues);

	checkIdPattern(obj.id, 'id', issues);
	checkEnum(obj.category, 'category', CATEGORIES, issues);
	checkNonEmptyString(obj.label, 'label', issues);
	checkNonEmptyString(obj.description, 'description', issues);

	if (obj.dependencies !== undefined)
		checkPinnedDeps(obj.dependencies, 'dependencies', issues);
	if (obj.devDependencies !== undefined)
		checkPinnedDeps(obj.devDependencies, 'devDependencies', issues);

	validateFilesArray(obj.files, 'files', issues);

	if (obj.options !== undefined)
		validateOptionsArray(obj.options, 'options', issues);

	if (obj.recommendedExtensions !== undefined)
		checkStringArray(obj.recommendedExtensions, 'recommendedExtensions', checkPlainString, issues);
	if (obj.implies !== undefined)
		checkStringArray(obj.implies, 'implies', checkIdPattern, issues);
	if (obj.excludes !== undefined)
		checkStringArray(obj.excludes, 'excludes', checkIdPattern, issues);
	if (obj.requires !== undefined)
		checkStringArray(obj.requires, 'requires', checkIdPattern, issues);

	if (obj.postInstall !== undefined)
		validatePostInstallArray(obj.postInstall, 'postInstall', issues);
	if (obj.packageJsonPatch !== undefined)
		validatePackageJsonPatch(obj.packageJsonPatch, 'packageJsonPatch', issues);
	if (obj.removeNotes !== undefined)
		checkPlainString(obj.removeNotes, 'removeNotes', issues);
}

function validateFilesArray(value: unknown, path: string, issues: UnitIssue[]): void {
	if (!Array.isArray(value)) {
		issues.push({ path, expected: 'an array', got: typeOf(value) });
		return;
	}
	value.forEach((file, i) => validateFile(file, `${path}[${i}]`, issues));
}

function validateFile(file: unknown, path: string, issues: UnitIssue[]): void {
	if (!isPlainObject(file)) {
		issues.push({ path, expected: 'an object', got: typeOf(file) });
		return;
	}
	checkAdditionalProps(file, path, FILE_KEYS, issues);
	checkNonEmptyString(file.dest, `${path}.dest`, issues);

	const hasSrc = file.src !== undefined;
	const hasContent = file.content !== undefined;
	if (hasSrc && hasContent)
		issues.push({ path, expected: 'exactly one of: src, content', got: 'both src and content' });
	else if (!hasSrc && !hasContent)
		issues.push({ path, expected: 'exactly one of: src, content', got: 'neither src nor content' });

	if (hasSrc)
		checkNonEmptyString(file.src, `${path}.src`, issues);
	if (hasContent)
		checkPlainString(file.content, `${path}.content`, issues);
	if (file.rename !== undefined)
		checkPlainString(file.rename, `${path}.rename`, issues);
	if (file.mode !== undefined)
		checkEnum(file.mode, `${path}.mode`, FILE_MODES, issues);
}

function validateOptionsArray(value: unknown, path: string, issues: UnitIssue[]): void {
	if (!Array.isArray(value)) {
		issues.push({ path, expected: 'an array', got: typeOf(value) });
		return;
	}
	value.forEach((option, i) => validateOption(option, `${path}[${i}]`, issues));
}

function validateOption(option: unknown, path: string, issues: UnitIssue[]): void {
	if (!isPlainObject(option)) {
		issues.push({ path, expected: 'an object', got: typeOf(option) });
		return;
	}
	checkAdditionalProps(option, path, OPTION_KEYS, issues);
	checkNonEmptyString(option.key, `${path}.key`, issues);
	checkNonEmptyString(option.label, `${path}.label`, issues);
	checkPlainString(option.default, `${path}.default`, issues);

	const choices = option.choices;
	if (!Array.isArray(choices)) {
		issues.push({ path: `${path}.choices`, expected: 'a non-empty array', got: typeOf(choices) });
		return;
	}
	if (choices.length === 0) {
		issues.push({ path: `${path}.choices`, expected: 'a non-empty array', got: 'empty array' });
		return;
	}
	choices.forEach((choice, i) => validateOptionChoice(choice, `${path}.choices[${i}]`, issues));

	// The schema's own prose says default "must match one of this option's
	// choice values" but can't express that as a structural constraint (it's a
	// cross-field check, not a shape check), so it's enforced here instead.
	if (typeof option.default === 'string') {
		const values = choices
			.filter(isPlainObject)
			.map(c => c.value)
			.filter((v): v is string => typeof v === 'string');
		if (!values.includes(option.default)) {
			issues.push({
				path: `${path}.default`,
				expected: values.length > 0 ? `one of: ${values.join(', ')}` : 'one of this option\'s choice values',
				got: JSON.stringify(option.default),
			});
		}
	}
}

function validateOptionChoice(choice: unknown, path: string, issues: UnitIssue[]): void {
	if (!isPlainObject(choice)) {
		issues.push({ path, expected: 'an object', got: typeOf(choice) });
		return;
	}
	checkAdditionalProps(choice, path, OPTION_CHOICE_KEYS, issues);
	checkNonEmptyString(choice.value, `${path}.value`, issues);
	checkNonEmptyString(choice.label, `${path}.label`, issues);
	if (choice.hint !== undefined)
		checkPlainString(choice.hint, `${path}.hint`, issues);
	if (choice.files !== undefined)
		validateFilesArray(choice.files, `${path}.files`, issues);
	if (choice.dependencies !== undefined)
		checkPinnedDeps(choice.dependencies, `${path}.dependencies`, issues);
	if (choice.devDependencies !== undefined)
		checkPinnedDeps(choice.devDependencies, `${path}.devDependencies`, issues);
}

function validatePostInstallArray(value: unknown, path: string, issues: UnitIssue[]): void {
	if (!Array.isArray(value)) {
		issues.push({ path, expected: 'an array', got: typeOf(value) });
		return;
	}
	value.forEach((entry, i) => validatePostInstall(entry, `${path}[${i}]`, issues));
}

function validatePostInstall(entry: unknown, path: string, issues: UnitIssue[]): void {
	if (!isPlainObject(entry)) {
		issues.push({ path, expected: 'an object', got: typeOf(entry) });
		return;
	}
	checkAdditionalProps(entry, path, POST_INSTALL_KEYS, issues);
	checkNonEmptyString(entry.id, `${path}.id`, issues);

	const command = entry.command;
	if (!Array.isArray(command))
		issues.push({ path: `${path}.command`, expected: 'a non-empty array', got: typeOf(command) });
	else if (command.length === 0)
		issues.push({ path: `${path}.command`, expected: 'a non-empty array', got: 'empty array' });
	else
		command.forEach((c, i) => checkPlainString(c, `${path}.command[${i}]`, issues));

	checkNonEmptyString(entry.prompt, `${path}.prompt`, issues);

	if (typeof entry.default !== 'boolean')
		issues.push({ path: `${path}.default`, expected: 'a boolean', got: typeOf(entry.default) });

	if (entry.requires !== undefined)
		checkEnum(entry.requires, `${path}.requires`, ['git'], issues);
}

function validatePackageJsonPatch(value: unknown, path: string, issues: UnitIssue[]): void {
	if (!isPlainObject(value)) {
		issues.push({ path, expected: 'an object', got: typeOf(value) });
		return;
	}
	checkAdditionalProps(value, path, PACKAGE_JSON_PATCH_KEYS, issues);
	if (value.scripts !== undefined)
		checkStringMap(value.scripts, `${path}.scripts`, issues);
	if (value.engines !== undefined)
		checkStringMap(value.engines, `${path}.engines`, issues);
	if (value.packageManager !== undefined)
		checkPlainString(value.packageManager, `${path}.packageManager`, issues);
}

// Reject a src that would let an external unit (loaded from a directory or an
// npm pack) reach outside its own definition's directory—the schema's
// description calls this out as a must, not just a convention. `..` is
// checked as a path segment rather than a substring so a legitimate
// `foo..bar.txt` filename doesn't false-positive.
function validateFileSources(obj: Record<string, unknown>, baseDir: string, issues: UnitIssue[]): void {
	for (const { path, src } of collectFileSrcs(obj)) {
		if (posix.isAbsolute(src) || src.split('/').includes('..')) {
			issues.push({ path, expected: 'a relative path inside the unit directory', got: JSON.stringify(src) });
			continue;
		}
		if (!existsSync(join(baseDir, src)))
			issues.push({ path, expected: 'a file that exists on disk', got: 'not found' });
	}
}

function collectFileSrcs(obj: Record<string, unknown>): { path: string; src: string }[] {
	return collectFileEntries(obj)
		.filter((entry): entry is { path: string; file: Record<string, unknown> & { src: string } } => typeof entry.file.src === 'string')
		.map(({ path, file }) => ({ path: `${path}.src`, src: file.src }));
}

// Every file-operation object a unit can contribute, wherever it's declared:
// the top-level `files` array at every index, and `options[].choices[].files`
// for every choice — including a non-default one, which `applyUnitOptions`
// splices into `unit.files` only once that choice is picked (options.ts:46-47),
// so a guard that only walked the default choice would leave a live route
// open. One walk shared by every pass that needs "every destination the unit
// can contribute" (containment below, and the `src`-escape check above) is
// deliberate: a second, independently-written walk is how one pass covers a
// shape the other misses. The specific near-miss: a collector scoped to
// `mode: 'copy'`, which resolves and compares correctly and simply never
// visits the operation that escapes.
function collectFileEntries(obj: Record<string, unknown>): { path: string; file: Record<string, unknown> }[] {
	const found: { path: string; file: Record<string, unknown> }[] = [];
	collectFileEntriesFromArray(obj.files, 'files', found);
	if (Array.isArray(obj.options)) {
		obj.options.forEach((option, i) => {
			if (!isPlainObject(option) || !Array.isArray(option.choices))
				return;
			option.choices.forEach((choice, j) => {
				if (isPlainObject(choice))
					collectFileEntriesFromArray(choice.files, `options[${i}].choices[${j}].files`, found);
			});
		});
	}
	return found;
}

function collectFileEntriesFromArray(value: unknown, prefix: string, found: { path: string; file: Record<string, unknown> }[]): void {
	if (!Array.isArray(value))
		return;
	value.forEach((file, i) => {
		if (isPlainObject(file))
			found.push({ path: `${prefix}[${i}]`, file });
	});
}

// The write-path guard (copy.ts's copyFileOp) refuses independently, but this
// is what stops an escaping unit from ever reaching it: every destination the
// unit can contribute — whatever `mode` the op carries, since copyFileOp
// writes through writeBuffer whenever the destination doesn't exist yet,
// regardless of mode — resolved and compared by the same function the
// write-path guard calls, never a second implementation of its own.
function validateContainment(obj: Record<string, unknown>, issues: UnitIssue[]): void {
	for (const { path, file } of collectFileEntries(obj)) {
		// A non-string dest/rename is already reported by checkNonEmptyString /
		// checkPlainString in validateFile; nothing more to check here.
		if (typeof file.dest !== 'string')
			continue;
		const op: FileOp = {
			dest: file.dest,
			...(typeof file.rename === 'string' ? { rename: file.rename } : {}),
		};
		const { contained, destination } = checkContainment(CONTAINMENT_ROOT, op);
		if (!contained)
			issues.push({ path: `${path}.dest`, expected: 'a destination that resolves inside the project root', got: JSON.stringify(destination) });
	}
}

function validateRelations(obj: Record<string, unknown>, knownIds: ReadonlySet<string>, issues: UnitIssue[]): void {
	checkKnownIds(obj.implies, 'implies', knownIds, issues);
	checkKnownIds(obj.excludes, 'excludes', knownIds, issues);
	checkKnownIds(obj.requires, 'requires', knownIds, issues);
}

function checkKnownIds(value: unknown, path: string, knownIds: ReadonlySet<string>, issues: UnitIssue[]): void {
	if (!Array.isArray(value))
		return;
	value.forEach((id, i) => {
		if (typeof id === 'string' && !knownIds.has(id))
			issues.push({ path: `${path}[${i}]`, expected: 'a known unit id', got: JSON.stringify(id) });
	});
}

// --- leaf checks -----------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Truthful `got` values for the common shapes a bad definition takes, matching
// the house style set by config/load.ts's hand-rolled checks.
function typeOf(value: unknown): string {
	if (value === undefined)
		return 'missing';
	if (value === null)
		return 'null';
	if (Array.isArray(value))
		return 'array';
	return typeof value;
}

function checkAdditionalProps(obj: Record<string, unknown>, prefix: string, allowed: ReadonlySet<string>, issues: UnitIssue[]): void {
	for (const key of Object.keys(obj)) {
		if (!allowed.has(key))
			issues.push({ path: prefix ? `${prefix}.${key}` : key, expected: 'a recognized property', got: `unknown key "${key}"` });
	}
}

function checkPlainString(value: unknown, path: string, issues: UnitIssue[]): void {
	if (typeof value !== 'string')
		issues.push({ path, expected: 'a string', got: typeOf(value) });
}

function checkNonEmptyString(value: unknown, path: string, issues: UnitIssue[]): void {
	if (typeof value !== 'string') {
		issues.push({ path, expected: 'a non-empty string', got: typeOf(value) });
		return;
	}
	if (value.length === 0)
		issues.push({ path, expected: 'a non-empty string', got: '""' });
}

function checkEnum(value: unknown, path: string, allowed: readonly string[], issues: UnitIssue[]): void {
	if (typeof value !== 'string') {
		issues.push({ path, expected: `one of: ${allowed.join(', ')}`, got: typeOf(value) });
		return;
	}
	if (!allowed.includes(value))
		issues.push({ path, expected: `one of: ${allowed.join(', ')}`, got: JSON.stringify(value) });
}

function checkIdPattern(value: unknown, path: string, issues: UnitIssue[]): void {
	const expected = 'a lowercase id matching ^[a-z0-9][a-z0-9-]*$';
	if (typeof value !== 'string') {
		issues.push({ path, expected, got: typeOf(value) });
		return;
	}
	if (!ID_PATTERN.test(value))
		issues.push({ path, expected, got: JSON.stringify(value) });
}

function checkPinnedDeps(value: unknown, path: string, issues: UnitIssue[]): void {
	if (!isPlainObject(value)) {
		issues.push({ path, expected: 'an object of exact-pin versions', got: typeOf(value) });
		return;
	}
	for (const [name, version] of Object.entries(value)) {
		const itemPath = `${path}["${name}"]`;
		if (typeof version !== 'string')
			issues.push({ path: itemPath, expected: 'an exact semver pin (e.g. 1.2.3)', got: typeOf(version) });
		else if (!PIN_PATTERN.test(version))
			issues.push({ path: itemPath, expected: 'an exact semver pin (e.g. 1.2.3)', got: JSON.stringify(version) });
	}
}

function checkStringMap(value: unknown, path: string, issues: UnitIssue[]): void {
	if (!isPlainObject(value)) {
		issues.push({ path, expected: 'an object of string values', got: typeOf(value) });
		return;
	}
	for (const [key, v] of Object.entries(value)) {
		if (typeof v !== 'string')
			issues.push({ path: `${path}["${key}"]`, expected: 'a string', got: typeOf(v) });
	}
}

function checkStringArray(value: unknown, path: string, itemCheck: (item: unknown, itemPath: string, issues: UnitIssue[]) => void, issues: UnitIssue[]): void {
	if (!Array.isArray(value)) {
		issues.push({ path, expected: 'an array', got: typeOf(value) });
		return;
	}
	value.forEach((item, i) => itemCheck(item, `${path}[${i}]`, issues));
}
