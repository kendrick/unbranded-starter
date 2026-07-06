import { diff3Merge } from 'node-diff3';

// The text three-way merge behind `unbranded update`: base is the recorded
// baseline (what we last wrote), mine is the user's on-disk file, theirs is the
// freshly rendered template. node-diff3 does the region math; this wrapper owns
// line splitting, marker rendering, and the vocabulary the rest of the CLI
// speaks — so the dependency stays swappable behind one small surface.

export type Merge3Result
	= | { result: 'clean'; merged: string }
		| { result: 'conflict'; merged: string; conflicts: number };

// What `update` does per file, derived from the three contents alone:
//   up-to-date   — the template didn't move (or the user already matches it)
//   clean-update — the user never touched the file; take the template
//   merged       — both sides changed, no overlap; take the merge
//   conflict     — overlapping edits; `merged` carries git-style markers
export type UpdateStatus = 'up-to-date' | 'clean-update' | 'merged' | 'conflict';

export function computeUpdate(opts: { base: string; mine: string; theirs: string }): { status: UpdateStatus; merged: string } {
	// Template unchanged, or the user hand-applied the update already: either
	// way the on-disk file is the right answer and nothing needs writing.
	if (opts.theirs === opts.base || opts.mine === opts.theirs)
		return { status: 'up-to-date', merged: opts.mine };
	if (opts.mine === opts.base)
		return { status: 'clean-update', merged: opts.theirs };
	const r = merge3(opts);
	return r.result === 'clean'
		? { status: 'merged', merged: r.merged }
		: { status: 'conflict', merged: r.merged };
}

// The labels mirror git's orientation from the user's seat: their file is
// "yours", the incoming template is the other side.
const MARKER_YOURS = '<<<<<<< yours\n';
const MARKER_MID = '=======\n';
const MARKER_TEMPLATE = '>>>>>>> template\n';

export function merge3(opts: { base: string; mine: string; theirs: string }): Merge3Result {
	// excludeFalseConflicts: both sides making the identical change is agreement,
	// not a conflict — common when a user hand-applied part of a template update.
	const regions = diff3Merge(
		splitKeepEol(opts.mine),
		splitKeepEol(opts.base),
		splitKeepEol(opts.theirs),
		{ excludeFalseConflicts: true },
	);

	let conflicts = 0;
	const out: string[] = [];
	for (const region of regions) {
		if (region.ok) {
			out.push(region.ok.join(''));
		}
		else if (region.conflict) {
			conflicts += 1;
			out.push(
				MARKER_YOURS,
				ensureTrailingEol(region.conflict.a.join('')),
				MARKER_MID,
				ensureTrailingEol(region.conflict.b.join('')),
				MARKER_TEMPLATE,
			);
		}
	}

	const merged = out.join('');
	return conflicts > 0 ? { result: 'conflict', merged, conflicts } : { result: 'clean', merged };
}

// Split keeping each line's own terminator, so join('') is the exact inverse:
// CRLF files and a missing trailing newline survive the round trip untouched.
function splitKeepEol(text: string): string[] {
	return text.length === 0 ? [] : text.split(/(?<=\n)/);
}

// A conflict block that ends the file without a newline would glue itself to
// the next marker line; give the marker its own line in that one case.
function ensureTrailingEol(block: string): string {
	if (block.length === 0 || block.endsWith('\n'))
		return block;
	return `${block}\n`;
}
