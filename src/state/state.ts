import type { CopyResult } from '../fs/copy';
import type { UnitId } from '../manifest/types';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, posix, relative, sep } from 'node:path';
import { PKG_ROOT } from '../util/paths';

// Bump when the on-disk shape changes in a way a reader can't tolerate. A future
// `unbranded update` keys off `schema`, not field-sniffing, so the envelope stays
// forward-parseable the same way the unit catalog does.
export const STATE_SCHEMA = 1;

// Lives at the project root, one level of visibility above node_modules. The
// leading dot keeps it out of the way while staying obviously ours.
export const STATE_FILENAME = '.unbranded.json';

// A self-describing breadcrumb. This file lands in every scaffolded repo, so an
// agent or person who stumbles on it should learn what wrote it and which
// commands read it without leaving the file. It sorts first in the envelope
// (leading underscore) so it's the first thing you see.
export const STATE_TOOL_HINT = 'unbranded manages the files below. Run `unbranded diff` to see your local drift or `unbranded doctor` to audit the repo; https://github.com/kendrick/unbranded-starter';

// User-managed config that rides in the state file rather than a separate dotfile.
// `ignore` lists doctor finding ids the repo has accepted; `unbranded doctor` reads
// it to suppress those findings. Hand-edited, so writeStateFile preserves it across
// re-scaffolds instead of letting a fresh envelope drop it.
export interface DoctorConfig {
	ignore?: string[];
}

export interface StateFile {
	// A `_`-prefixed metadata key, mirroring the $schema/_comment convention in
	// tool-written JSON. Sorts first, so it reads as the file's own header.
	_tool: string;
	schema: number;
	// The CLI version that scaffolded this project. Recorded so a later diff/update
	// can reason about which template generation the hashes below came from.
	version: string;
	units: UnitId[];
	// dest path (relative to the project root, posix-normalized) → content hash.
	// One hash per file keeps the diff a clean one-line-per-change.
	files: Record<string, string>;
	// Optional user config. Absent on a fresh scaffold; present once a user opts in
	// (e.g. adds `doctor.ignore`). Preserved verbatim across re-scaffolds.
	doctor?: DoctorConfig;
}

export function hashBuffer(buf: Buffer): string {
	return createHash('sha256').update(buf).digest('hex');
}

// Pure envelope builder. Sorts units and file keys so the object a caller hands
// in can't leak its own key order into the output; the serializer sorts again,
// but sorting here keeps the in-memory value honest for tests too.
export function buildStateFile(input: { version: string; units: UnitId[]; files: Record<string, string>; doctor?: DoctorConfig }): StateFile {
	return {
		_tool: STATE_TOOL_HINT,
		schema: STATE_SCHEMA,
		version: input.version,
		units: [...input.units].sort(),
		files: sortRecord(input.files),
		// Only carry the block when it holds something, so a clean scaffold never
		// writes an empty `doctor: {}` nobody asked for.
		...(input.doctor && Object.keys(input.doctor).length > 0 ? { doctor: input.doctor } : {}),
	};
}

// Recursively key-sorted JSON. Determinism is the whole point of the state file:
// re-scaffolding the same units must produce a byte-identical envelope so a VCS
// diff shows real drift, not incidental key reordering.
export function serializeState(state: StateFile): string {
	return `${JSON.stringify(sortKeys(state), null, 2)}\n`;
}

// Thin IO shell over the pure builder. Reads each landed file to hash it and
// stamps the running CLI version, then writes the envelope to the project root.
// Returns the path written for the caller to log.
//
// `extraWrites` carries absolute paths of files a run produced outside the copy
// loop: the computed `.nvmrc` and `.vscode/extensions.json`, which can't ship as
// static templates (see install/run.ts) and so never pass through `results`.
// Without them the map is incomplete and `diff` silently ignores their drift.
export function writeStateFile(opts: { targetDir: string; units: UnitId[]; results: CopyResult[]; extraWrites?: string[] }): string {
	const files: Record<string, string> = {};
	const dests = [...opts.results.map(r => r.dest), ...(opts.extraWrites ?? [])];
	for (const dest of dests) {
		// A skipped write can leave a dest that was never created (nothing on our
		// side to hash), so only track files that actually exist post-apply.
		if (!existsSync(dest))
			continue;
		const rel = toPosix(relative(opts.targetDir, dest));
		files[rel] = hashBuffer(readFileSync(dest));
	}

	// Preserve any user-managed config (e.g. doctor.ignore) a prior run or a hand
	// edit left in the file. buildStateFile otherwise emits a fresh envelope that
	// would silently drop it on every re-scaffold, so the "durable off switch" for
	// doctor findings wouldn't survive the next `unbranded` run.
	const prior = readStateFile(opts.targetDir);

	const state = buildStateFile({ version: readCliVersion(), units: opts.units, files, doctor: prior?.doctor });
	const path = join(opts.targetDir, STATE_FILENAME);
	writeFileSync(path, serializeState(state));
	return path;
}

// Returns undefined for both "no state" and "unreadable state". `diff` treats an
// untracked project as a normal, clean exit, so a malformed file must degrade to
// the same friendly path rather than throwing a stack trace at a CI job.
export function readStateFile(dir: string): StateFile | undefined {
	const path = join(dir, STATE_FILENAME);
	if (!existsSync(path))
		return undefined;
	try {
		return JSON.parse(readFileSync(path, 'utf-8')) as StateFile;
	}
	catch {
		return undefined;
	}
}

function readCliVersion(): string {
	const pkg = JSON.parse(readFileSync(join(PKG_ROOT, 'package.json'), 'utf-8')) as { version: string };
	return pkg.version;
}

function sortRecord(record: Record<string, string>): Record<string, string> {
	const out: Record<string, string> = {};
	for (const key of Object.keys(record).sort())
		out[key] = record[key] as string;
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
