import type { UnitSource } from '../manifest/types';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, relative, sep } from 'node:path';
import { PKG_ROOT } from '../util/paths';

// Bump when the on-disk shape changes in a way a reader can't tolerate. Schema 2
// added the sibling maps (`options`, `attribution`, `modes`) and the baseline
// sidecar additively, so a schema-1 reader still parsed the parts it knew. Schema 3
// is the first bump that isn't additive: `units` changes from bare id strings to
// {id, source} entries, and an older reader handed a namespaced id would drop it as
// unknown rather than refuse. That's what readStateFile's version gate exists for.
export const STATE_SCHEMA = 3;

// Lives at the project root, one level of visibility above node_modules. The
// leading dot keeps it out of the way while staying obviously ours.
export const STATE_FILENAME = '.unbranded.json';

// The sidecar directory next to the state file: `baseline/` copies of managed
// files (the merge base for `unbranded update`) plus a README that tells a human
// what the directory is and why it should be committed.
export const SIDECAR_DIR = '.unbranded';

// A self-describing breadcrumb. This file lands in every scaffolded repo, so an
// agent or person who stumbles on it should learn what wrote it and which
// commands read it without leaving the file. It sorts first in the envelope
// (leading underscore) so it's the first thing you see.
export const STATE_TOOL_HINT = 'unbranded manages the files below. Run `unbranded diff` to see your local drift or `unbranded doctor` to audit the repo; https://github.com/kendrick/unbranded-starter';

// How a tracked file was produced, recorded so `update` can pick the right
// refresh path without replaying the manifest: text merge for `copy`, structured
// merge for `merge-json`, block re-check for `append-if-missing`, and
// regeneration for `computed` (.nvmrc, .vscode/extensions.json).
export type TrackedFileMode = 'copy' | 'merge-json' | 'append-if-missing' | 'computed';

// One file a run produced, wherever it came from: the copy loop or the computed
// writes after it. `dest` is absolute; writeStateFile relativizes.
export interface TrackedWrite {
	dest: string;
	unit: string;
	mode: TrackedFileMode;
}

// User-managed config that rides in the state file rather than a separate dotfile.
// `ignore` lists doctor finding ids the repo has accepted; `unbranded doctor` reads
// it to suppress those findings. Hand-edited, so writeStateFile preserves it across
// re-scaffolds instead of letting a fresh envelope drop it.
export interface DoctorConfig {
	ignore?: string[];
}

// One installed unit and where its definition came from. Provenance is recorded
// because a namespaced id alone doesn't say where to find the definition again:
// `remove` and `update` have to re-read a local unit's files, and only the path
// gets them back. Built-ins carry `{kind:'builtin'}` and their ids stay bare
// forever, since `core-eslint` is already written into shipped 1.x state files.
export interface StateUnit {
	id: string;
	source: UnitSource;
}

export interface StateFile {
	// A `_`-prefixed metadata key, mirroring the $schema/_comment convention in
	// tool-written JSON. Sorts first, so it reads as the file's own header.
	_tool: string;
	schema: number;
	// The CLI version that last wrote this envelope. Recorded so a later
	// diff/update can reason about which template generation touched it.
	version: string;
	units: StateUnit[];
	// dest path (relative to the project root, posix-normalized) → content hash.
	// One hash per file keeps the diff a clean one-line-per-change.
	files: Record<string, string>;
	// Schema-2 siblings, all optional so a schema-1 envelope reads cleanly with
	// them absent (consumers degrade rather than error):
	// the run's resolved unit options (e.g. eslintFlavor), needed to re-render
	// templates and to compute option-dependent package.json contributions…
	options?: Record<string, string>;
	// …which unit wrote each tracked file, recorded at write time because the
	// manifest's dests can drift across versions and a replay would misattribute…
	attribution?: Record<string, string>;
	// …and how each file was produced, so update picks the right refresh path.
	modes?: Record<string, TrackedFileMode>;
	// Optional user config. Absent on a fresh scaffold; present once a user opts in
	// (e.g. adds `doctor.ignore`). Preserved verbatim across re-scaffolds.
	doctor?: DoctorConfig;
}

// Built-in ids carry no provenance worth recording — there is exactly one place a
// built-in can come from — so the whole set converts in one call.
export function builtinUnits(ids: string[]): StateUnit[] {
	return ids.map(id => ({ id, source: { kind: 'builtin' } }));
}

export function hashBuffer(buf: Buffer): string {
	return createHash('sha256').update(buf).digest('hex');
}

// Pure envelope builder. Sorts units and record keys so the object a caller hands
// in can't leak its own key order into the output; the serializer sorts again,
// but sorting here keeps the in-memory value honest for tests too. Empty maps are
// omitted entirely — same rule as the doctor block, no noise nobody asked for.
export function buildStateFile(input: {
	version: string;
	units: StateUnit[];
	files: Record<string, string>;
	options?: Record<string, string>;
	attribution?: Record<string, string>;
	modes?: Record<string, TrackedFileMode>;
	doctor?: DoctorConfig;
}): StateFile {
	return {
		_tool: STATE_TOOL_HINT,
		schema: STATE_SCHEMA,
		version: input.version,
		units: [...input.units].sort(byId),
		files: sortRecord(input.files),
		...whenPresent('options', input.options),
		...whenPresent('attribution', input.attribution),
		...whenPresent('modes', input.modes),
		...(input.doctor && Object.keys(input.doctor).length > 0 ? { doctor: input.doctor } : {}),
	};
}

// Recursively key-sorted JSON. Determinism is the whole point of the state file:
// re-scaffolding the same units must produce a byte-identical envelope so a VCS
// diff shows real drift, not incidental key reordering.
export function serializeState(state: StateFile): string {
	// Tab indent so the .unbranded.json we write into a project satisfies the ESLint
	// config unbranded ships (antfu's jsonc/indent), the same reason package.json is
	// tab-seeded (#48). This file is entirely unbranded-owned, so there's no user
	// formatting to preserve — we always emit our canonical form.
	return `${JSON.stringify(sortKeys(state), null, '\t')}\n`;
}

// Thin IO shell over the pure builder. Hashes each landed file, records who wrote
// it and how, refreshes the baseline sidecar, and MERGES with any prior envelope
// rather than replacing it: the day-2 verbs (remove, update) reason over the whole
// scaffold history, so a run that adds one unit must not forget the earlier ones.
// Only `unbranded remove` is allowed to shrink the tracked set.
export function writeStateFile(opts: {
	targetDir: string;
	units: StateUnit[];
	writes: TrackedWrite[];
	options?: Record<string, string>;
}): string {
	const files: Record<string, string> = {};
	const attribution: Record<string, string> = {};
	const modes: Record<string, TrackedFileMode> = {};

	// A skipped write can leave a dest that was never created (nothing on our
	// side to hash), so only track files that actually exist post-apply.
	const landed = opts.writes.filter(w => existsSync(w.dest));
	for (const w of landed) {
		const rel = toPosix(relative(opts.targetDir, w.dest));
		files[rel] = hashBuffer(readFileSync(w.dest));
		attribution[rel] = w.unit;
		modes[rel] = w.mode;
	}

	// Preserve everything a prior run (or a hand edit, for doctor.ignore) left in
	// the file. New values win per key; a schema-1 prior simply has no maps to carry.
	const prior = priorStateForWrite(opts.targetDir);
	const merged = {
		version: readCliVersion(),
		units: mergeUnits(prior?.units ?? [], opts.units),
		files: { ...prior?.files, ...files },
		options: { ...prior?.options, ...opts.options },
		attribution: { ...prior?.attribution, ...attribution },
		modes: { ...prior?.modes, ...modes },
		doctor: prior?.doctor,
	};

	syncSidecar(opts.targetDir, landed, merged.files, merged.modes);

	const path = join(opts.targetDir, STATE_FILENAME);
	writeFileSync(path, serializeState(buildStateFile(merged)));
	return path;
}

// The one sanctioned way the tracked set shrinks (writeStateFile only grows it).
// Drops the removed units, the rels they owned, and the option keys they defined,
// then reuses the sidecar sync to prune their baselines. `removeOptionKeys` is a
// parameter because which unit owns which option is manifest knowledge, and this
// module stays manifest-free. When the last unit goes, the envelope and sidecar
// go with it — a lingering README would advertise management that no longer exists.
export function applyRemovalToState(opts: {
	targetDir: string;
	removeUnits: string[];
	removeFiles: string[];
	removeOptionKeys?: string[];
}): void {
	const prior = priorStateForWrite(opts.targetDir);
	if (!prior)
		return;

	const gone = new Set(opts.removeFiles);
	const removed = new Set(opts.removeUnits);
	const units = prior.units.filter(u => !removed.has(u.id));

	if (units.length === 0) {
		rmSync(join(opts.targetDir, STATE_FILENAME), { force: true });
		rmSync(join(opts.targetDir, SIDECAR_DIR), { recursive: true, force: true });
		return;
	}

	const merged = {
		version: readCliVersion(),
		units,
		files: dropKeys(prior.files ?? {}, gone),
		options: dropKeys(prior.options ?? {}, new Set(opts.removeOptionKeys ?? [])),
		attribution: dropKeys(prior.attribution ?? {}, gone),
		modes: dropKeys(prior.modes ?? {}, gone),
		doctor: prior.doctor,
	};

	syncSidecar(opts.targetDir, [], merged.files, merged.modes);
	writeFileSync(join(opts.targetDir, STATE_FILENAME), serializeState(buildStateFile(merged)));
}

function dropKeys<V extends string>(record: Record<string, V>, gone: ReadonlySet<string>): Record<string, V> {
	return Object.fromEntries(Object.entries(record).filter(([k]) => !gone.has(k)));
}

// `unbranded update`'s state door: refresh hashes for what's now on disk and
// move baselines to the CURRENT template. The two legitimately diverge — a
// keep-mine resolution leaves the user's bytes on disk while the merge base
// still has to advance, or the next update would misread the same drift again
// (or worse, silently take the template over a file the user chose to keep).
// Touches nothing else: no growth, no shrinking, no attribution changes.
export function refreshTrackedFiles(opts: {
	targetDir: string;
	entries: Record<string, { hash: string; baseline?: string }>;
}): void {
	const prior = priorStateForWrite(opts.targetDir);
	if (!prior)
		return;

	const files = { ...prior.files };
	for (const [rel, entry] of Object.entries(opts.entries)) {
		files[rel] = entry.hash;
		if (entry.baseline !== undefined) {
			const dest = join(opts.targetDir, SIDECAR_DIR, 'baseline', rel);
			mkdirSync(dirname(dest), { recursive: true });
			writeFileSync(dest, entry.baseline);
		}
	}

	const state = buildStateFile({
		version: readCliVersion(),
		units: prior.units,
		files,
		options: prior.options,
		attribution: prior.attribution,
		modes: prior.modes,
		doctor: prior.doctor,
	});
	writeFileSync(join(opts.targetDir, STATE_FILENAME), serializeState(state));
}

export type StateRead
	= | { kind: 'ok'; state: StateFile }
		| { kind: 'none' }
		| { kind: 'unsupported'; schema: number };

// Three outcomes rather than two, because "written by a newer unbranded" and "not
// tracked here" must not collapse into the same answer. They used to: an unreadable
// file returned undefined, and `diff` reads undefined as an untracked project and
// exits 0 clean. A CI gate would then report no drift on a repo it can't actually
// read. `none` still covers both "no file" and "malformed JSON" — degrading a
// corrupt file to the friendly path beats throwing a stack trace at a CI job.
export function readStateFile(dir: string): StateRead {
	const path = join(dir, STATE_FILENAME);
	if (!existsSync(path))
		return { kind: 'none' };

	let raw: unknown;
	try {
		raw = JSON.parse(readFileSync(path, 'utf-8'));
	}
	catch {
		return { kind: 'none' };
	}

	const doc = raw as Partial<StateFile> & { units?: unknown };
	const schema = typeof doc.schema === 'number' ? doc.schema : 1;
	if (schema > STATE_SCHEMA)
		return { kind: 'unsupported', schema };

	return { kind: 'ok', state: { ...doc, units: normalizeUnits(doc.units) } as StateFile };
}

export function unsupportedStateMessage(schema: number): string {
	return `${STATE_FILENAME} here was written by a newer unbranded (state schema ${schema}; this build understands ${STATE_SCHEMA}). Upgrade unbranded to manage this project.`;
}

// Schema 1 and 2 stored units as bare id strings, and those files can only name
// built-ins — nothing else could be installed before schema 3 — so widening them
// on read is exact rather than a guess. Entries neither string nor id-bearing are
// dropped; a file that malformed would have to be hand-mangled, since the version
// gate above already turns back anything a future unbranded wrote.
function normalizeUnits(raw: unknown): StateUnit[] {
	if (!Array.isArray(raw))
		return [];

	const out: StateUnit[] = [];
	for (const entry of raw) {
		if (typeof entry === 'string') {
			out.push({ id: entry, source: { kind: 'builtin' } });
			continue;
		}
		if (entry !== null && typeof entry === 'object' && typeof (entry as { id?: unknown }).id === 'string') {
			const e = entry as { id: string; source?: unknown };
			out.push({ id: e.id, source: normalizeSource(e.source) });
		}
	}
	return out;
}

function normalizeSource(raw: unknown): UnitSource {
	if (raw === null || typeof raw !== 'object')
		return { kind: 'builtin' };

	const s = raw as { kind?: unknown; path?: unknown; name?: unknown; version?: unknown };
	if (s.kind === 'dir' && typeof s.path === 'string')
		return { kind: 'dir', path: s.path };
	// Packs ship in a later release and deliberately reuse schema 3, so a pack entry
	// arrives without a version bump to announce it. Reading it here is what makes
	// that promise good.
	if (s.kind === 'pack' && typeof s.name === 'string' && typeof s.version === 'string')
		return { kind: 'pack', name: s.name, version: s.version };
	return { kind: 'builtin' };
}

// Every writer in this module merges onto whatever is already on disk, so each one
// needs the same refusal: merging onto an envelope we can't fully read would drop
// the parts we didn't understand. Commands gate first and report properly; this
// throw is the backstop for a path that forgot to.
function priorStateForWrite(targetDir: string): StateFile | undefined {
	const read = readStateFile(targetDir);
	if (read.kind === 'unsupported')
		throw new Error(unsupportedStateMessage(read.schema));
	return read.kind === 'ok' ? read.state : undefined;
}

// New entries win, so re-applying a unit whose directory moved records the current
// path rather than the stale one.
function mergeUnits(prior: StateUnit[], next: StateUnit[]): StateUnit[] {
	const byIdMap = new Map<string, StateUnit>();
	for (const u of [...prior, ...next])
		byIdMap.set(u.id, u);
	return [...byIdMap.values()];
}

// Plain comparator rather than localeCompare: the envelope has to be byte-identical
// across machines and locales, which is the whole reason this file sorts at all.
function byId(a: StateUnit, b: StateUnit): number {
	if (a.id === b.id)
		return 0;
	return a.id < b.id ? -1 : 1;
}

const SIDECAR_README = `# The unbranded Sidecar

[unbranded](https://github.com/kendrick/unbranded-starter) scaffolded some of this project's tooling config, and this directory is its working data. \`baseline/\` keeps a byte-exact copy of each managed file as unbranded last wrote it.

## Why It Should Be Committed

The baselines are what let \`unbranded update\` pull newer template versions into your repo without losing local edits: with the original bytes on hand, it can merge your changes and the template's changes instead of asking you to pick one wholesale. Baselines only work if they travel with the repo, so commit this directory like any other file.

Deleting it breaks nothing today, but \`unbranded update\` would lose its merge base and fall back to asking before overwriting each changed file.

\`unbranded diff\` shows how your files have drifted from what was scaffolded; \`unbranded doctor\` audits the repo.
`;

// The baseline sidecar: byte-exact copies of copy-mode files as this run wrote
// them — the merge base `unbranded update` needs to three-way merge user edits
// with a newer template. Structured (merge-json), append, and computed files refresh
// structurally instead, so a text baseline would only mislead. Stray baselines
// are pruned: a wrong merge base is worse than none.
function syncSidecar(targetDir: string, landed: TrackedWrite[], files: Record<string, string>, modes: Record<string, TrackedFileMode>): void {
	const baselineDir = join(targetDir, SIDECAR_DIR, 'baseline');

	for (const w of landed) {
		if (w.mode !== 'copy')
			continue;
		const dest = join(baselineDir, relative(targetDir, w.dest));
		mkdirSync(dirname(dest), { recursive: true });
		writeFileSync(dest, readFileSync(w.dest));
	}

	// Tracked copy-mode files keep their baseline (a prior run's copy is still the
	// honest base even when this run didn't rewrite the file); everything else goes.
	const keep = new Set(Object.keys(files).filter(rel => modes[rel] === 'copy'));
	if (existsSync(baselineDir)) {
		const entries = (readdirSync(baselineDir, { recursive: true }) as string[]).map(e => join(baselineDir, e));
		for (const abs of entries.filter(e => statSync(e).isFile())) {
			if (!keep.has(toPosix(relative(baselineDir, abs))))
				rmSync(abs);
		}
		// Longest paths first, so nested empty dirs unwind bottom-up.
		for (const abs of entries.filter(e => existsSync(e) && statSync(e).isDirectory()).sort((a, b) => b.length - a.length)) {
			if (readdirSync(abs).length === 0)
				rmdirSync(abs);
		}
	}

	mkdirSync(join(targetDir, SIDECAR_DIR), { recursive: true });
	writeFileSync(join(targetDir, SIDECAR_DIR, 'README.md'), SIDECAR_README);
}

function readCliVersion(): string {
	const pkg = JSON.parse(readFileSync(join(PKG_ROOT, 'package.json'), 'utf-8')) as { version: string };
	return pkg.version;
}

// Spread helper for the optional envelope maps: absent or empty stays absent.
function whenPresent<K extends string, V extends string>(key: K, record: Record<string, V> | undefined): Partial<Record<K, Record<string, V>>> {
	if (!record || Object.keys(record).length === 0)
		return {};
	return { [key]: sortRecord(record) } as Partial<Record<K, Record<string, V>>>;
}

function sortRecord<V extends string>(record: Record<string, V>): Record<string, V> {
	const out: Record<string, V> = {};
	for (const key of Object.keys(record).sort())
		out[key] = record[key] as V;
	return out;
}

function sortKeys(value: unknown): unknown {
	if (Array.isArray(value))
		return value.map(sortKeys);
	if (value !== null && typeof value === 'object') {
		const out: Record<string, unknown> = {};
		for (const key of Object.keys(value).sort())
			out[key] = sortKeys((value as Record<string, unknown>)[key]);
		return out;
	}
	return value;
}

// Manifest and dest paths are authored/compared posix-style; normalize the
// native separator so a Windows-recorded envelope diffs against a posix one.
function toPosix(p: string): string {
	return p.split(sep).join(posix.sep);
}
