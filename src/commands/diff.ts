import type { FilePlan } from '../fs/copy';
import type { Catalog } from '../manifest/catalog';
import type { AnyUnit, FileOp } from '../manifest/types';
import type { StateFile } from '../state/state';
import { existsSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { formatUnparseableSkip, planFileOp, renderPlanDiff } from '../fs/copy';
import { loadCatalog, unitsDirsFor } from '../manifest/catalog';
import { UNITS } from '../manifest/index';
import { applyVscodeSettings } from '../manifest/vscode-settings';
import {
	hashBuffer,
	malformedStateMessage,
	readStateFile,
	STATE_FILENAME,
	unsupportedStateMessage,
} from '../state/state';
import { PKG_ROOT } from '../util/paths';

// Unlike the `--dry-run --diff` preview, which reports what a *fresh* init would
// do, `unbranded diff` compares the project against the hashes recorded in
// .unbranded.json at scaffold time. Two independent axes of drift:
//   user-modified    — the on-disk file no longer matches what we recorded
//   template-updated — the shipped template no longer matches what we recorded
//   both             — both axes drifted
export type DiffCategory = 'unchanged' | 'user-modified' | 'template-updated' | 'both';

export const DIFF_SCHEMA = 1;

// Pure core: three hashes in, a verdict out. `onDisk` undefined means the file
// was deleted — still a user edit. `template` undefined means no shipped template
// backs this record anymore, so the template axis can't be judged.
// A merged file records the merge result, which matches the template's bytes only
// when no file existed before the scaffold, so its caller passes update's verdict
// as `templateUpdated` instead of a hash.
export function classify(hashes: {
	recorded: string;
	onDisk?: string;
	template?: string;
	templateUpdated?: boolean;
}): DiffCategory {
	const userModified = hashes.onDisk !== hashes.recorded;
	const templateUpdated =
		hashes.templateUpdated ??
		(hashes.template !== undefined && hashes.template !== hashes.recorded);
	if (userModified && templateUpdated) return 'both';
	if (userModified) return 'user-modified';
	if (templateUpdated) return 'template-updated';
	return 'unchanged';
}

export interface DiffFile {
	path: string;
	status: DiffCategory;
	// The template-vs-disk plan, reused to render a unified patch on `--diff`.
	// Absent when the record's unit no longer ships the file.
	plan?: FilePlan;
}

export interface DiffReport {
	drift: boolean;
	files: DiffFile[];
}

export interface ComputeDiffOpts {
	state: StateFile;
	targetDir: string;
	pkgRoot?: string;
	projectName?: string;
	// The assembled catalog when local units are in play. Absent means built-ins
	// only, which is what every caller wanted before --units-dir existed.
	catalog?: Catalog;
}

// Rebuilds each recorded unit's file plans, then walks the recorded file map as
// the source of truth so even a file whose unit was dropped still gets judged.
export function computeDiff(opts: ComputeDiffOpts): DiffReport {
	const fallbackRoot = opts.pkgRoot ?? PKG_ROOT;
	const units = opts.catalog?.units ?? UNITS;
	const byId = new Map<string, AnyUnit>(units.map((u) => [u.id, u]));

	const planByRel = new Map<string, FilePlan>();
	const opModeByRel = new Map<string, FileOp['mode']>();
	const installedIds = new Set(opts.state.units.map((u) => u.id));
	for (const { id } of opts.state.units) {
		const catalogUnit = byId.get(id);
		// A unit whose definition we can't load leaves its files judged on the user
		// axis alone: no plan means no template hash, and classify already reads that
		// as "the template axis can't be judged" rather than as drift.
		if (!catalogUnit) continue;
		// Replay the generator init used. The raw catalog op has no lint keys, so
		// planning it would report template-updated on a clean scaffold. The generated
		// op carries inline `content` and no src file to hash, so its template axis
		// has to come from planFileOp's outcome below.
		const unit = applyVscodeSettings(catalogUnit, installedIds);
		const pkgRoot = opts.catalog?.templateRoots.get(id) ?? fallbackRoot;
		for (const op of unit.files) {
			const plan = planFileOp(op, {
				pkgRoot,
				targetDir: opts.targetDir,
				...(opts.projectName !== undefined ? { projectName: opts.projectName } : {}),
			});
			planByRel.set(toPosix(plan.rel), plan);
			opModeByRel.set(toPosix(plan.rel), op.mode);
		}
	}

	const files: DiffFile[] = [];
	for (const [rel, recorded] of sortedEntries(opts.state.files)) {
		const plan = planByRel.get(rel);
		const destPath = plan?.dest ?? join(opts.targetDir, ...rel.split(posix.sep));
		const onDisk = existsSync(destPath) ? hashBuffer(readFileSync(destPath)) : undefined;
		const mode = opts.state.modes?.[rel] ?? opModeByRel.get(rel);
		const merged = mode === 'merge-json' || mode === 'append-if-missing';
		// A merged file's recorded hash is the merge result, which matches the
		// template's bytes only when no file existed before the scaffold. So judge
		// it by update's rule instead, where a plan with nothing to change is
		// current. A deleted or unparseable file leaves the axis unjudged, and the
		// user axis reports it.
		const templateUpdated =
			merged && plan && onDisk !== undefined && !plan.unparseable
				? plan.outcome !== 'skip' && plan.diff !== undefined
				: undefined;
		const template =
			!merged && plan && existsSync(plan.src) ? hashBuffer(readFileSync(plan.src)) : undefined;
		files.push({
			path: rel,
			status: classify({
				recorded,
				...(onDisk !== undefined ? { onDisk } : {}),
				...(template !== undefined ? { template } : {}),
				...(templateUpdated !== undefined ? { templateUpdated } : {}),
			}),
			...(plan !== undefined ? { plan } : {}),
		});
	}

	return { drift: files.some((f) => f.status !== 'unchanged'), files };
}

export interface RunDiffOpts {
	cwd?: string;
	json?: boolean;
	// Print the unified patch for each drifted file, reusing the init preview's
	// renderer. Off by default so the plain report stays one line per file.
	diff?: boolean;
	// `--units-dir`: load local units from here instead of the paths the scaffold
	// recorded. The override is for a directory that moved since.
	unitsDir?: string;
}

// Thin shell: read state, delegate to the pure core, render, return an exit code.
// Non-zero on drift so it drops straight into a CI gate; zero (with a nudge) when
// the project was never scaffolded, since that's not an error.
export function runDiff(opts: RunDiffOpts = {}): number {
	const cwd = opts.cwd ?? process.cwd();
	const read = readStateFile(cwd);

	// Refuse rather than report clean. This is the case the version gate exists for:
	// diff is a CI gate, and answering "no drift" for a project we can't read is
	// worse than any error. Nothing goes to stdout either, so a --json consumer
	// fails on empty input instead of parsing a confident, wrong report.
	if (read.kind === 'unsupported') {
		process.stderr.write(`unbranded diff: ${unsupportedStateMessage(read.schema)}\n`);
		return 1;
	}
	if (read.kind === 'malformed') {
		process.stderr.write(`unbranded diff: ${malformedStateMessage()}\n`);
		return 1;
	}
	const state = read.kind === 'ok' ? read.state : undefined;

	if (!state) {
		if (opts.json) {
			process.stdout.write(
				`${JSON.stringify({ schema: DIFF_SCHEMA, tracked: false, drift: false, files: [] }, null, 2)}\n`,
			);
		} else {
			process.stdout.write(
				`No ${STATE_FILENAME} here. Run \`unbranded\` to scaffold and start tracking drift.\n`,
			);
		}
		return 0;
	}

	const catalog = loadCatalog({
		unitsDirs: unitsDirsFor(
			state.units.map((u) => u.source),
			cwd,
			opts.unitsDir,
		),
		onMissing: 'warn',
	});
	// Warnings go to stderr so --json keeps a clean stdout for its consumer.
	for (const warning of catalog.warnings) process.stderr.write(`unbranded diff: ${warning}\n`);

	const report = computeDiff({ state, targetDir: cwd, catalog });

	if (opts.json) {
		process.stdout.write(
			`${JSON.stringify(
				{
					schema: DIFF_SCHEMA,
					tracked: true,
					drift: report.drift,
					files: report.files.map((f) => ({ path: f.path, status: f.status })),
				},
				null,
				2,
			)}\n`,
		);
		return report.drift ? 1 : 0;
	}

	process.stdout.write(formatDiff(report, opts.diff ?? false));
	return report.drift ? 1 : 0;
}

const STATUS_LABELS: Record<DiffCategory, string> = {
	'unchanged': 'unchanged',
	'user-modified': 'user-modified',
	'template-updated': 'template-updated',
	'both': 'user+template',
};

function formatDiff(report: DiffReport, withDiff: boolean): string {
	const width = Math.max(...Object.values(STATUS_LABELS).map((l) => l.length));
	// Name the baseline so nobody mistakes this for the `--dry-run` init preview.
	const lines: string[] = [`Drift vs ${STATE_FILENAME} (recorded at scaffold):`, ''];

	for (const file of report.files) {
		lines.push(`${STATUS_LABELS[file.status].padEnd(width)}  ${file.path}`);
		// Plain text, not clack: the status stays user-modified (they did edit it),
		// but a reader needs to know why unbranded can't merge into it.
		if (file.plan?.unparseable) lines.push(`  ${formatUnparseableSkip(file.path)}`);
		if (withDiff && file.status !== 'unchanged' && file.plan) {
			const patch = renderPlanDiff(file.plan);
			if (patch) lines.push(patch);
		}
	}

	lines.push('');
	lines.push(report.drift ? 'Drift detected.' : 'No drift.');
	return `${lines.join('\n')}\n`;
}

function sortedEntries(record: Record<string, string>): [string, string][] {
	return Object.entries(record).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

function toPosix(p: string): string {
	return p.split(/[/\\]/).join(posix.sep);
}
