import { existsSync, mkdirSync, readFileSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, relative, sep } from 'node:path';

export interface JournalEntry {
	path: string;
	// null means the run created this file—there was nothing to restore, so
	// rollback deletes it instead.
	before: Buffer | null;
	// Every ancestor directory that didn't exist yet at record time, up to the
	// nearest one that did. That boundary is what keeps pruning exact: a
	// directory the project already had is never a rollback candidate. Order
	// doesn't matter here, since rollback sorts them deepest-first itself.
	dirsCreated: string[];
}

export interface WriteJournal {
	recordBefore: (path: string) => void;
	entries: () => readonly JournalEntry[];
}

// A run-scoped record of what stood at each path before this run touched it,
// so a failed install can be undone byte-for-byte. First-touch wins: two
// units can target the same destination (two append-if-missing contributions
// to `.gitignore` are the real case), and only the bytes on disk before
// *either* touched it are a valid rollback point—recording the second
// write's "before" would restore mid-run state, not the pre-run one.
export function createJournal(): WriteJournal {
	const entries: JournalEntry[] = [];
	const seen = new Set<string>();

	return {
		recordBefore(path: string) {
			if (seen.has(path))
				return;
			seen.add(path);

			const before = existsSync(path) ? readFileSync(path) : null;

			// Walk upward from the file's directory, collecting every ancestor
			// that doesn't exist yet. Doing this at record time, before any
			// sibling write can create one of these directories, is what lets
			// rollback prune exactly the directories this run made.
			const dirsCreated: string[] = [];
			let dir = dirname(path);
			while (!existsSync(dir)) {
				dirsCreated.push(dir);
				const parent = dirname(dir);
				if (parent === dir)
					break; // hit the filesystem root; stop rather than loop forever
				dir = parent;
			}

			entries.push({ path, before, dirsCreated });
		},
		entries: () => entries,
	};
}

export interface RollbackReport {
	restored: string[];
	deleted: string[];
	prunedDirs: string[];
	failures: { path: string; message: string }[];
}

// Undoes a journal against the filesystem. Best-effort by design: a failed
// install has already left the target in a bad state, and aborting rollback
// partway through on the first error would only make that worse. Every entry
// gets its own try/catch, and a failure is collected rather than thrown.
export function rollbackJournal(journal: WriteJournal): RollbackReport {
	const restored: string[] = [];
	const deleted: string[] = [];
	const failures: { path: string; message: string }[] = [];
	const allDirs = new Set<string>();

	for (const entry of journal.entries()) {
		for (const dir of entry.dirsCreated)
			allDirs.add(dir);

		try {
			if (entry.before === null) {
				rmSync(entry.path, { force: true });
				deleted.push(entry.path);
			}
			else {
				mkdirSync(dirname(entry.path), { recursive: true });
				writeFileSync(entry.path, entry.before);
				restored.push(entry.path);
			}
		}
		catch (err) {
			failures.push({ path: entry.path, message: err instanceof Error ? err.message : String(err) });
		}
	}

	// Deepest first, so a child's file is gone before its parent is asked to
	// go empty. rmdirSync throws on a non-empty directory, which is exactly
	// the signal that something this run didn't create still lives there—
	// caught and left alone rather than escalated to a failure.
	const prunedDirs: string[] = [];
	const byDepthDesc = [...allDirs].sort((a, b) => b.split(sep).length - a.split(sep).length || b.length - a.length);
	for (const dir of byDepthDesc) {
		try {
			rmdirSync(dir);
			prunedDirs.push(dir);
		}
		catch {
			// Not empty, or already removed as another entry's ancestor—both
			// are the correct outcome, not an error.
		}
	}

	return { restored, deleted, prunedDirs, failures };
}

// Pure and clack-free, so tests can call it directly. Plain ASCII on purpose:
// nothing here is colorized, so `--no-color` has nothing to strip.
export function formatRollbackReport(report: RollbackReport, targetDir: string): string {
	const lines: string[] = [
		`Rolled back: ${report.restored.length} file(s) restored, ${report.deleted.length} created file(s) deleted.`,
	];
	for (const f of report.failures)
		lines.push(`  could not restore ${relative(targetDir, f.path)}: ${f.message}`);
	lines.push('`node_modules` and the lockfile are untouched: the package manager owns those, and rollback does not reach them.');
	return lines.join('\n');
}
