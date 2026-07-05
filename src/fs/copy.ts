import type { FileOp } from '../manifest/types';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join as joinNative, posix, relative, resolve as resolveNative } from 'node:path';
import { isCancel, log, select } from '@clack/prompts';
import { createPatch } from 'diff';
import { cancelAndExit } from '../util/cancel';

// 'merged' and 'appended' are the non-clobbering outcomes the two structured
// modes produce: a merge-json write that folded new keys in, or an
// append-if-missing write that added new lines. They stay distinct from
// 'overwrote' so the summary can tell a wholesale replace from a graft.
export type CopyAction = 'copied' | 'overwrote' | 'merged' | 'appended' | 'skipped';

export interface CopyResult {
	src: string;
	dest: string;
	action: CopyAction;
	reason?: 'identical' | 'user-skip';
}

export interface CopyOptions {
	pkgRoot: string;
	targetDir: string;
	// Substituted into any `{projectName}` token in `dest`. Provided by the
	// new-project flow; absent in augment mode.
	projectName?: string;
	// Non-interactive override for conflicts. Set by --config mode so E2E
	// runs don't hang on a prompt.
	onConflict?: 'overwrite' | 'skip';
}

export async function copyFileOp(op: FileOp, opts: CopyOptions): Promise<CopyResult> {
	const { srcPath, destPath } = resolvePaths(op, opts);

	// Read as buffer, not string. Writing through a string round-trips through
	// the default encoding, which clobbers Windows CRLF inside source files
	// that were authored with mixed line endings.
	const srcBuf = readSource(op, srcPath);

	// Nothing to merge or append into yet, so every mode collapses to a plain
	// write of the source. Keeps first-time scaffolding identical across modes.
	if (!existsSync(destPath)) {
		writeBuffer(destPath, srcBuf);
		return { src: srcPath, dest: destPath, action: 'copied' };
	}

	// Short-circuit byte-identical files before we waste a prompt or a parse.
	// A merge or append of a file into itself is a no-op, so this is correct
	// for every mode, not just raw copy.
	const destBuf = readFileSync(destPath);
	if (srcBuf.equals(destBuf)) {
		return { src: srcPath, dest: destPath, action: 'skipped', reason: 'identical' };
	}

	const mode = op.mode ?? 'copy';
	if (mode === 'merge-json') {
		return mergeJsonOp(srcPath, destPath, srcBuf, destBuf, opts.onConflict);
	}
	if (mode === 'append-if-missing') {
		return appendIfMissingOp(srcPath, destPath, srcBuf, destBuf);
	}

	const resolution = opts.onConflict ?? await promptConflict(destPath, srcBuf, destBuf);

	if (resolution === 'overwrite') {
		writeBuffer(destPath, srcBuf);
		return { src: srcPath, dest: destPath, action: 'overwrote' };
	}
	return { src: srcPath, dest: destPath, action: 'skipped', reason: 'user-skip' };
}

// Buffer of the source, whichever way the FileOp carries it: a computed `content`
// string, or a `src` file read off disk. One reader so every mode (copy, merge,
// append, dry-run) treats an inline config the same as a shipped template.
function readSource(op: FileOp, srcPath: string): Buffer {
	return op.content !== undefined ? Buffer.from(op.content, 'utf-8') : readFileSync(srcPath);
}

function resolvePaths(op: FileOp, opts: CopyOptions): { srcPath: string; destPath: string } {
	// Manifest paths are posix-style for cross-platform authoring. Split on
	// posix.sep and let node:path build the native form for the host. A
	// content-mode op has no src file; the path is a label for reporting only,
	// never read, so we key it off dest to stay recognizable in results.
	const srcPath = op.src !== undefined
		? joinNative(opts.pkgRoot, ...op.src.split(posix.sep))
		: `<computed:${op.dest}>`;

	const interpolatedDest = opts.projectName
		? op.dest.replace(/\{projectName\}/g, opts.projectName)
		: op.dest;
	const destBase = resolveNative(opts.targetDir, ...interpolatedDest.split(posix.sep));

	// `rename` swaps just the basename — the directory portion of `dest` still
	// applies. The motivating case: shipped `.gitignore.template` → final
	// `.gitignore`, because npm strips top-level `.gitignore` from tarballs.
	const destPath = op.rename
		? resolveNative(dirname(destBase), op.rename)
		: destBase;

	return { srcPath, destPath };
}

async function mergeJsonOp(
	srcPath: string,
	destPath: string,
	srcBuf: Buffer,
	destBuf: Buffer,
	onConflict: CopyOptions['onConflict'],
): Promise<CopyResult> {
	const existingText = destBuf.toString('utf-8');
	const existing = JSON.parse(existingText) as unknown;
	const incoming = JSON.parse(srcBuf.toString('utf-8')) as unknown;

	const { merged, conflict } = deepMergeJson(existing, incoming);

	// Re-serialize with the destination's own indentation so a merge doesn't
	// silently reformat the user's file wider than the keys it actually touched.
	const proposedBuf = Buffer.from(`${JSON.stringify(merged, null, detectIndent(existingText))}\n`, 'utf-8');

	if (!conflict) {
		// A clean merge that added nothing is a no-op — report it like an
		// identical skip so idempotent reruns stay quiet.
		if (deepEqual(merged, existing)) {
			return { src: srcPath, dest: destPath, action: 'skipped', reason: 'identical' };
		}
		writeBuffer(destPath, proposedBuf);
		return { src: srcPath, dest: destPath, action: 'merged' };
	}

	// A same-key/different-value collision isn't ours to settle silently. Route
	// it through the same diff-and-prompt UX raw copies use, showing the
	// patch-wins merge as the proposed side. `onConflict` (config mode) resolves
	// it without a prompt so CI never blocks.
	const resolution = onConflict ?? await promptConflict(destPath, proposedBuf, destBuf);
	if (resolution === 'overwrite') {
		writeBuffer(destPath, proposedBuf);
		return { src: srcPath, dest: destPath, action: 'merged' };
	}
	return { src: srcPath, dest: destPath, action: 'skipped', reason: 'user-skip' };
}

function appendIfMissingOp(srcPath: string, destPath: string, srcBuf: Buffer, destBuf: Buffer): CopyResult {
	const { content, changed } = appendMissingLines(destBuf, srcBuf);
	if (!changed) {
		return { src: srcPath, dest: destPath, action: 'skipped', reason: 'identical' };
	}
	writeBuffer(destPath, content);
	return { src: srcPath, dest: destPath, action: 'appended' };
}

// The would-do verdicts for --dry-run. 'conflict' has no run-time analogue —
// a real run resolves it into an overwrite/merge or a skip — but the plan
// surfaces it so the user can see every collision before committing to a run.
export type PlanOutcome = 'create' | 'merge' | 'append' | 'skip' | 'conflict';

export interface FilePlan {
	src: string;
	dest: string;
	// dest relative to targetDir, so the report reads in the user's terms
	// rather than dumping absolute scratch paths.
	rel: string;
	outcome: PlanOutcome;
	// The before/after text, when a file exists and would change. Lets --diff
	// render the unified patch without re-deriving the proposed content.
	diff?: { existing: string; proposed: string };
}

// The read-only twin of copyFileOp: same dispatch, same merge/append math, but
// it classifies instead of writing. Kept in lockstep with copyFileOp on purpose
// so the dry-run preview can't drift from what a real run would actually do.
export function planFileOp(op: FileOp, opts: CopyOptions): FilePlan {
	const { srcPath, destPath } = resolvePaths(op, opts);
	const rel = relative(opts.targetDir, destPath);
	const srcBuf = readSource(op, srcPath);

	const base = { src: srcPath, dest: destPath, rel };

	if (!existsSync(destPath))
		return { ...base, outcome: 'create' };

	const destBuf = readFileSync(destPath);
	if (srcBuf.equals(destBuf))
		return { ...base, outcome: 'skip' };

	const mode = op.mode ?? 'copy';
	if (mode === 'merge-json') {
		const existingText = destBuf.toString('utf-8');
		const existing = JSON.parse(existingText) as unknown;
		const { merged, conflict } = deepMergeJson(existing, JSON.parse(srcBuf.toString('utf-8')));
		if (!conflict && deepEqual(merged, existing))
			return { ...base, outcome: 'skip' };
		const proposed = `${JSON.stringify(merged, null, detectIndent(existingText))}\n`;
		return { ...base, outcome: conflict ? 'conflict' : 'merge', diff: { existing: existingText, proposed } };
	}

	if (mode === 'append-if-missing') {
		const { content, changed } = appendMissingLines(destBuf, srcBuf);
		if (!changed)
			return { ...base, outcome: 'skip' };
		return { ...base, outcome: 'append', diff: { existing: destBuf.toString('utf-8'), proposed: content.toString('utf-8') } };
	}

	// Raw copy into an existing, differing file: the user has to choose, so it's
	// a conflict in plan terms even though a real run might auto-resolve it.
	return { ...base, outcome: 'conflict', diff: { existing: destBuf.toString('utf-8'), proposed: srcBuf.toString('utf-8') } };
}

// Colorized unified patch for a plan that would change an existing file, or
// null when there's nothing to diff (a fresh create or an identical skip).
export function renderPlanDiff(plan: FilePlan): string | null {
	if (!plan.diff)
		return null;
	return colorizeDiff(createPatch(plan.rel, plan.diff.existing, plan.diff.proposed, 'existing', 'proposed'));
}

function writeBuffer(path: string, buf: Buffer): void {
	// Intermediate dirs may not exist when the manifest writes into a fresh
	// project (e.g. dest='src/components/ui/cn.ts' in a brand-new repo).
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, buf);
}

async function promptConflict(destPath: string, src: Buffer, dest: Buffer): Promise<'overwrite' | 'skip'> {
	const firstChoice = await select<'overwrite' | 'skip' | 'diff'>({
		message: `Conflict: ${destPath} already exists`,
		options: [
			{ value: 'overwrite', label: 'Overwrite' },
			{ value: 'skip', label: 'Skip' },
			{ value: 'diff', label: 'Show diff' },
		],
	});
	if (isCancel(firstChoice)) {
		return cancelAndExit();
	}
	if (firstChoice !== 'diff')
		return firstChoice;

	// Render unified diff with red/green +/- lines. `diff.createPatch` produces
	// the standard hunk format; we colorize the prefix characters for the
	// terminal. After showing it, re-prompt without the diff option so the
	// user doesn't loop back to it from itself.
	log.message(colorizeDiff(createPatch(destPath, dest.toString('utf-8'), src.toString('utf-8'), 'existing', 'proposed')));

	const secondChoice = await select<'overwrite' | 'skip'>({
		message: 'Now what?',
		options: [
			{ value: 'overwrite', label: 'Overwrite' },
			{ value: 'skip', label: 'Skip' },
		],
	});
	if (isCancel(secondChoice)) {
		return cancelAndExit();
	}
	return secondChoice;
}

interface MergeResult {
	merged: unknown;
	// True once any leaf collides: same key, incompatible values. The caller
	// needs this to decide between a silent write and a conflict prompt.
	conflict: boolean;
}

// Generic recursive JSON merge. Unlike mergePackageJson this knows nothing about
// package.json's canonical field order — for an arbitrary target file the only
// stable ordering we can honor is the user's own, so existing keys keep their
// position and incoming-only keys append in source order. Objects merge deep;
// arrays and scalars are treated as atomic (a differing value is a conflict, not
// something to splice).
function deepMergeJson(existing: unknown, incoming: unknown): MergeResult {
	if (isPlainObject(existing) && isPlainObject(incoming)) {
		const merged: Record<string, unknown> = {};
		let conflict = false;

		for (const key of Object.keys(existing)) {
			if (key in incoming) {
				const sub = deepMergeJson(existing[key], incoming[key]);
				merged[key] = sub.merged;
				conflict ||= sub.conflict;
			}
			else {
				merged[key] = existing[key];
			}
		}
		for (const key of Object.keys(incoming)) {
			if (!(key in existing))
				merged[key] = incoming[key];
		}
		return { merged, conflict };
	}

	// Equal leaves aren't a conflict even when they collide — the user already
	// has exactly what we'd write. Otherwise the patch wins the merged value,
	// but we flag it so the caller can offer the choice rather than impose it.
	if (deepEqual(existing, incoming))
		return { merged: existing, conflict: false };
	return { merged: incoming, conflict: true };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deepEqual(a: unknown, b: unknown): boolean {
	if (a === b)
		return true;
	if (Array.isArray(a) && Array.isArray(b)) {
		return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
	}
	if (isPlainObject(a) && isPlainObject(b)) {
		const keys = Object.keys(a);
		return keys.length === Object.keys(b).length
			&& keys.every(k => k in b && deepEqual(a[k], b[k]));
	}
	return false;
}

// Match the destination's indentation so a merge writes back the way the user
// (or their prior tooling) formatted it. Defaults to two spaces — what npm and
// most package.json files in the wild use. Mirrors the detector in install/run;
// duplicated rather than shared to avoid a util import just for six lines.
function detectIndent(content: string): string {
	for (const line of content.split('\n')) {
		const match = /^([ \t]+)\S/.exec(line);
		if (match?.[1])
			return match[1];
	}
	return '  ';
}

interface AppendResult {
	content: Buffer;
	changed: boolean;
}

// Line-set append: fold in only the source lines the target doesn't already
// carry, order-preserving. Built for ignore-style files where duplicate rules
// are noise, so a rerun after the lines land is a no-op. Blank lines are never
// appended — they'd otherwise accumulate on every run — and the trailing newline
// is preserved so the file stays POSIX-clean.
function appendMissingLines(existing: Buffer, incoming: Buffer): AppendResult {
	const existingText = existing.toString('utf-8');
	const present = new Set(existingText.split('\n'));

	const missing = incoming.toString('utf-8').split('\n').filter(line => line !== '' && !present.has(line));
	if (missing.length === 0)
		return { content: existing, changed: false };

	const base = existingText.length > 0 && !existingText.endsWith('\n')
		? `${existingText}\n`
		: existingText;
	return { content: Buffer.from(`${base}${missing.join('\n')}\n`, 'utf-8'), changed: true };
}

function colorizeDiff(patch: string): string {
	return patch.split('\n').map((line) => {
		// Skip the file headers (`+++`, `---`) when coloring; they're metadata
		// rather than content changes.
		if (line.startsWith('+') && !line.startsWith('+++'))
			return `[32m${line}[0m`;
		if (line.startsWith('-') && !line.startsWith('---'))
			return `[31m${line}[0m`;
		if (line.startsWith('@@'))
			return `[36m${line}[0m`;
		return line;
	}).join('\n');
}
