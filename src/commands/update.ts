import type { AnyUnit, FileOp } from '../manifest/types';
import type { StateFile } from '../state/state';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { cancel, confirm, intro, isCancel, log, note, outro, select } from '@clack/prompts';
import { createPatch } from 'diff';
import { effectiveDest } from '../detect/signals';
import { colorizeDiff, planFileOp } from '../fs/copy';
import { computeUpdate } from '../fs/merge3';
import { mergePackageJson } from '../fs/merge-json';
import { isDirtyGitTree } from '../install/git';
import { detectIndent } from '../install/run';
import { loadCatalog, unitsDirsFor } from '../manifest/catalog';
import { applyUnitOptions } from '../manifest/options';
import { hashBuffer, readStateFile, refreshTrackedFiles, SIDECAR_DIR, unsupportedStateMessage } from '../state/state';
import { cancelAndExit } from '../util/cancel';
import { colorEnabled } from '../util/color';
import { PKG_ROOT } from '../util/paths';

// Per-file verdicts. The first four are #34's contract; the rest are the honest
// degradations: needs-choice when no merge base exists (schema-1 scaffolds, a
// deleted sidecar, or a JSON value collision), and three report-only states.
export type UpdateFileStatus
	= | 'up-to-date'
		| 'clean-update'
		| 'merged'
		| 'conflict'
		| 'needs-choice'
		| 'template-gone'
		| 'user-deleted'
		| 'computed';

export interface UpdateFilePlan {
	rel: string;
	status: UpdateFileStatus;
	// What an apply would write: the template, the merge, or marker text.
	proposed?: string;
	// The current template render, kept because a keep-mine resolution still has
	// to advance the baseline to it.
	theirs?: string;
	// On-disk content, for --diff rendering.
	existing?: string;
}

export interface UpdatePkgPlan {
	changed: boolean;
	existing?: string;
	proposed?: string;
}

export interface UpdatePlanResult {
	files: UpdateFilePlan[];
	pkg: UpdatePkgPlan;
}

// Filesystem in, plan out (the auditRepo pattern): reads disk, baselines, and
// the current templates; writes nothing. Copy-mode files go through the
// three-way engine; merge-json and append files reuse planFileOp, which is what
// keeps update's structured behavior in lockstep with the scaffold's.
export function planUpdate(opts: { targetDir: string; state: StateFile; units: AnyUnit[]; pkgRoot: string; templateRoots?: ReadonlyMap<string, string> }): UpdatePlanResult {
	const { state, targetDir } = opts;
	const byId = new Map<string, AnyUnit>(opts.units.map(u => [u.id, u]));

	// Current template render for every file the installed units ship, with the
	// recorded options baked in so a react-flavor scaffold replays as react. Each
	// entry carries its own root: a local unit's templates sit beside its
	// definition, not in the package.
	const replay = new Map<string, { op: FileOp; content: string; root: string }>();
	const resolved: AnyUnit[] = [];
	for (const { id } of state.units) {
		const catalogUnit = byId.get(id);
		if (!catalogUnit)
			continue;
		const unit = applyUnitOptions(catalogUnit, state.options ?? {});
		resolved.push(unit);
		const root = opts.templateRoots?.get(id) ?? opts.pkgRoot;
		for (const op of unit.files) {
			// A template that's gone leaves the file with no replay entry, which reads
			// downstream as "no template backs this anymore" — the same degrade as a
			// unit we couldn't load at all. Throwing here would take down the whole
			// update over one deleted file in someone's units directory.
			const src = op.src === undefined ? undefined : join(root, ...op.src.split(posix.sep));
			if (op.content === undefined && (src === undefined || !existsSync(src)))
				continue;
			const content = op.content ?? readFileSync(src as string, 'utf-8');
			replay.set(effectiveDest(op), { op, content, root });
		}
	}

	const files: UpdateFilePlan[] = [];
	for (const rel of Object.keys(state.files).sort()) {
		const mode = state.modes?.[rel] ?? replay.get(rel)?.op.mode ?? 'copy';
		if (mode === 'computed') {
			// .nvmrc and extensions.json regenerate from the environment and the
			// unit set, not from a template generation — re-running the scaffold is
			// their update path.
			files.push({ rel, status: 'computed' });
			continue;
		}

		const entry = replay.get(rel);
		if (!entry) {
			files.push({ rel, status: 'template-gone' });
			continue;
		}

		const abs = join(targetDir, rel);
		if (!existsSync(abs)) {
			// The user deleted it; resurrecting their deletion would be a hostile
			// kind of helpful.
			files.push({ rel, status: 'user-deleted' });
			continue;
		}

		if (mode === 'merge-json' || mode === 'append-if-missing') {
			const plan = planFileOp(entry.op, { pkgRoot: entry.root, targetDir });
			if (plan.outcome === 'skip' || !plan.diff) {
				files.push({ rel, status: 'up-to-date' });
			}
			else if (plan.outcome === 'conflict') {
				// Same key, different value. With no base there's no telling a user
				// customization from a stale template value — the user decides.
				files.push({ rel, status: 'needs-choice', proposed: plan.diff.proposed, existing: plan.diff.existing });
			}
			else {
				files.push({ rel, status: 'merged', proposed: plan.diff.proposed, existing: plan.diff.existing });
			}
			continue;
		}

		const mineBuf = readFileSync(abs);
		const mine = mineBuf.toString('utf-8');
		const theirs = entry.content;
		const baselinePath = join(targetDir, SIDECAR_DIR, 'baseline', rel);
		let base = existsSync(baselinePath) ? readFileSync(baselinePath, 'utf-8') : undefined;
		// No baseline, but the recorded hash proves the disk bytes are exactly
		// what we wrote — so the disk IS the base, and the merge stays exact.
		if (base === undefined && hashBuffer(mineBuf) === state.files[rel])
			base = mine;

		if (base === undefined) {
			files.push(mine === theirs
				? { rel, status: 'up-to-date', theirs }
				: { rel, status: 'needs-choice', proposed: theirs, theirs, existing: mine });
			continue;
		}

		const r = computeUpdate({ base, mine, theirs });
		files.push({
			rel,
			status: r.status,
			...(r.status === 'up-to-date' ? {} : { proposed: r.merged }),
			theirs,
			existing: mine,
		});
	}

	return { files, pkg: planPkgUpdate(targetDir, resolved) };
}

// package.json isn't a tracked file — it's re-derived: run the same structured
// merge a scaffold would and see whether anything comes out different. Scripts,
// engines, and packageManager are existing-wins, so what the user wrote holds.
// Dependency pins are not, and shouldn't be: moving pins is the point of
// update, so a drifted spec belongs in the plan the user accepts rather than
// in a prompt. Hence no keep-set here, where init passes one (#113).
function planPkgUpdate(targetDir: string, units: AnyUnit[]): UpdatePkgPlan {
	const pkgPath = join(targetDir, 'package.json');
	if (!existsSync(pkgPath) || units.length === 0)
		return { changed: false };

	const raw = readFileSync(pkgPath, 'utf-8');
	const existing = JSON.parse(raw) as Record<string, unknown>;
	const merged = mergePackageJson(existing, units.map(u => ({
		dependencies: u.dependencies,
		devDependencies: u.devDependencies,
		scripts: u.packageJsonPatch?.scripts,
		engines: u.packageJsonPatch?.engines,
		packageManager: u.packageJsonPatch?.packageManager,
	})));

	if (deepEqualJson(merged, existing))
		return { changed: false };
	return { changed: true, existing: raw, proposed: `${JSON.stringify(merged, null, detectIndent(raw))}\n` };
}

const STATUS_LABELS: Record<UpdateFileStatus, string> = {
	'up-to-date': 'up-to-date',
	'clean-update': 'update',
	'merged': 'merge',
	'conflict': 'conflict',
	'needs-choice': 'needs choice',
	'template-gone': 'template gone',
	'user-deleted': 'deleted by you',
	'computed': 'computed',
};

// Exported for direct testing — pure, no clack.
export function formatUpdateReport(plan: UpdatePlanResult): string {
	const width = Math.max(...Object.values(STATUS_LABELS).map(l => l.length));
	const lines = plan.files.map(f => `${STATUS_LABELS[f.status].padEnd(width)}  ${f.rel}`);
	lines.push(`${(plan.pkg.changed ? 'merge' : 'up-to-date').padEnd(width)}  package.json`);
	return lines.join('\n');
}

export type UpdateStrategy = 'ours' | 'theirs' | 'markers';

export interface RunUpdateOpts {
	cwd?: string;
	yes?: boolean;
	dryRun?: boolean;
	diff?: boolean;
	force?: boolean;
	// Global answer for every conflict/needs-choice file. Without it, --yes runs
	// fail on conflicts instead of guessing, and interactive runs ask per file.
	strategy?: UpdateStrategy;
	// `--units-dir`: load local units from here instead of the paths the scaffold
	// recorded. The override is for a directory that moved since.
	unitsDir?: string;
}

export async function runUpdate(opts: RunUpdateOpts = {}): Promise<number> {
	const cwd = opts.cwd ?? process.cwd();
	const read = readStateFile(cwd);
	if (read.kind === 'unsupported') {
		process.stderr.write(`unbranded update: ${unsupportedStateMessage(read.schema)}\n`);
		return 1;
	}
	if (read.kind === 'none') {
		process.stdout.write('unbranded update: nothing is tracked in this directory (no .unbranded.json).\n');
		return 0;
	}
	const state = read.state;

	intro(opts.dryRun ? 'unbranded update (dry run)' : 'unbranded update');

	if (!opts.force && !opts.dryRun && await isDirtyGitTree(cwd)) {
		log.warn('Uncommitted changes in the git working tree — a clean tree is your undo button (`git checkout .`) if this update goes sideways.');
		if (!opts.yes) {
			const proceed = await confirm({ message: 'Update a dirty tree anyway?', initialValue: false });
			if (isCancel(proceed))
				return cancelAndExit();
			if (!proceed) {
				cancel('Cancelled.');
				return 0;
			}
		}
	}

	const catalog = loadCatalog({
		unitsDirs: unitsDirsFor(state.units.map(u => u.source), cwd, opts.unitsDir),
		onMissing: 'warn',
	});
	for (const warning of catalog.warnings)
		log.warn(warning);

	const plan = planUpdate({ targetDir: cwd, state, units: catalog.units, pkgRoot: PKG_ROOT, templateRoots: catalog.templateRoots });
	note(formatUpdateReport(plan), 'Update plan');

	if (opts.diff) {
		for (const f of plan.files) {
			if (f.proposed !== undefined && f.existing !== undefined && f.proposed !== f.existing)
				log.message(colorizeDiff(createPatch(f.rel, f.existing, f.proposed, 'existing', 'proposed'), colorEnabled()));
		}
		if (plan.pkg.changed && plan.pkg.existing && plan.pkg.proposed)
			log.message(colorizeDiff(createPatch('package.json', plan.pkg.existing, plan.pkg.proposed, 'existing', 'proposed'), colorEnabled()));
	}

	if (opts.dryRun) {
		outro('Dry run: nothing written.');
		return 0;
	}

	const auto = plan.files.filter(f => f.status === 'clean-update' || f.status === 'merged');
	const contested = plan.files.filter(f => f.status === 'conflict' || f.status === 'needs-choice');
	if (auto.length === 0 && contested.length === 0 && !plan.pkg.changed) {
		outro('Everything up to date.');
		return 0;
	}

	if (!opts.yes) {
		const proceed = await confirm({ message: 'Apply?', initialValue: true });
		if (isCancel(proceed))
			return cancelAndExit();
		if (!proceed) {
			cancel('Cancelled.');
			return 0;
		}
	}

	// Conflicts need an answer before anything is written. --strategy answers
	// globally; a --yes run without one fails loudly rather than guessing.
	const resolutions = new Map<string, UpdateStrategy>();
	if (contested.length > 0) {
		if (opts.strategy) {
			for (const f of contested) {
				if (opts.strategy === 'markers' && f.status === 'needs-choice') {
					// No merge base means no markers to render; keeping the user's
					// file is the only honest fallback.
					log.warn(`${f.rel}: no merge base for markers; keeping your version.`);
					resolutions.set(f.rel, 'ours');
				}
				else {
					resolutions.set(f.rel, opts.strategy);
				}
			}
		}
		else if (opts.yes) {
			log.error(`Conflicts need a decision: ${contested.map(f => f.rel).join(', ')}. Re-run with --strategy <ours|theirs|markers>, or interactively.`);
			outro('Nothing written.');
			return 1;
		}
		else {
			for (const f of contested) {
				const options = f.status === 'conflict'
					? [
							{ value: 'ours' as const, label: 'Keep mine' },
							{ value: 'theirs' as const, label: 'Take the template' },
							{ value: 'markers' as const, label: 'Write conflict markers' },
						]
					: [
							{ value: 'ours' as const, label: 'Keep mine' },
							{ value: 'theirs' as const, label: 'Take the template' },
						];
				const choice = await select<UpdateStrategy>({ message: `${f.rel}: ${f.status === 'conflict' ? 'edits overlap the template change' : 'no merge base to reconcile with'}`, options });
				if (isCancel(choice))
					return cancelAndExit();
				resolutions.set(f.rel, choice);
			}
		}
	}

	// Apply. For contested copy files, "theirs" means the raw template; for the
	// JSON needs-choice case, `proposed` already holds the structured fold, and
	// the raw template would clobber the user's sibling keys.
	let written = 0;
	const refresh: Record<string, { hash: string; baseline?: string }> = {};
	for (const f of plan.files) {
		const abs = join(cwd, f.rel);
		let content: string | undefined;
		if (f.status === 'clean-update' || f.status === 'merged') {
			content = f.proposed;
		}
		else if (f.status === 'conflict' || f.status === 'needs-choice') {
			const choice = resolutions.get(f.rel);
			if (choice === 'theirs')
				content = f.theirs ?? f.proposed;
			else if (choice === 'markers')
				content = f.proposed;
		}

		if (content !== undefined) {
			writeFileSync(abs, content);
			written += 1;
		}

		// Baselines advance to the current template for every copy-mode file we
		// rendered, resolved or kept — a keep-mine choice must not be re-litigated
		// (or silently overturned) by the next run.
		if (f.theirs !== undefined)
			refresh[f.rel] = { hash: hashBuffer(readFileSync(abs)), baseline: f.theirs };
		else if (content !== undefined)
			refresh[f.rel] = { hash: hashBuffer(readFileSync(abs)) };
	}

	if (plan.pkg.changed && plan.pkg.proposed) {
		writeFileSync(join(cwd, 'package.json'), plan.pkg.proposed);
		written += 1;
	}

	refreshTrackedFiles({ targetDir: cwd, entries: refresh });

	log.success(`Updated ${written} file${written === 1 ? '' : 's'}.`);
	const followUps = [
		...(plan.pkg.changed ? ['package.json changed — run your package manager\'s install to sync the lockfile.'] : []),
		...plan.files.filter(f => resolutions.get(f.rel) === 'markers').map(f => `${f.rel} has conflict markers to resolve.`),
	];
	if (followUps.length > 0)
		note(followUps.map(s => `• ${s}`).join('\n'), 'Next steps');
	outro('Done.');
	return 0;
}

// Order-insensitive structural equality: mergePackageJson re-sorts keys, and a
// pure reordering is not a change worth writing.
function deepEqualJson(a: unknown, b: unknown): boolean {
	if (a === b)
		return true;
	if (Array.isArray(a) && Array.isArray(b))
		return a.length === b.length && a.every((v, i) => deepEqualJson(v, b[i]));
	if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
		const ka = Object.keys(a);
		const kb = Object.keys(b);
		return ka.length === kb.length && ka.every(k => k in (b as Record<string, unknown>) && deepEqualJson((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
	}
	return false;
}
