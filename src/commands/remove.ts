import type { PackageJsonRemoval } from '../fs/merge-json';
import type { Unit, UnitId } from '../manifest/types';
import type { StateFile, TrackedFileMode } from '../state/state';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cancel, confirm, intro, isCancel, log, note, outro } from '@clack/prompts';
import { effectiveDest } from '../detect/signals';
import { removePackageJsonEntries } from '../fs/merge-json';
import { isDirtyGitTree } from '../install/git';
import { detectIndent } from '../install/run';
import { UNITS } from '../manifest/index';
import { applyUnitOptions } from '../manifest/options';
import { dependentsOf } from '../manifest/resolve';
import { applyRemovalToState, hashBuffer, readStateFile } from '../state/state';
import { cancelAndExit } from '../util/cancel';

export interface RemovalPlan {
	// The target plus, under --cascade, everything that depends on it.
	units: UnitId[];
	// Whole-file-owned (copy/computed) files that exist on disk. `modified` means
	// the on-disk bytes no longer match the recorded hash — the user's edits are
	// in there, so deleting needs a per-file yes.
	deletions: { rel: string; modified: boolean }[];
	// merge-json / append-if-missing files: they carry user content alongside the
	// unit's, so they stay on disk and merely stop being tracked.
	retained: { rel: string; mode: TrackedFileMode }[];
	// Reference-counted package.json strip list (scripts carry expected values).
	pkg: PackageJsonRemoval;
	// package.json fields remove won't touch on its own (engines, packageManager).
	manualPkg: string[];
	// The removed units' removeNotes, printed as next steps.
	notes: string[];
}

// Filesystem in, plan out — same pattern as auditRepo, so the whole decision
// surface is testable without prompts. Nothing here writes.
export function planRemoval(opts: { targetDir: string; state: StateFile; removeUnits: UnitId[]; units: Unit[] }): RemovalPlan {
	const { state, removeUnits } = opts;
	const byId = new Map(opts.units.map(u => [u.id, u]));
	const removedSet = new Set(removeUnits);
	const remaining = state.units.filter(u => !removedSet.has(u));

	const candidates: { rel: string; mode: TrackedFileMode }[] = [];
	if (state.attribution) {
		for (const [rel, owner] of Object.entries(state.attribution)) {
			if (removedSet.has(owner))
				candidates.push({ rel, mode: state.modes?.[rel] ?? 'copy' });
		}
	}
	else {
		// Schema-1 fallback: attribute by replaying the manifest's dests. A dest a
		// remaining unit also declares is not solely owned and survives. Computed
		// files predate attribution entirely and stay tracked — documented degrade.
		const remainingDests = new Set(remaining.flatMap(id => (byId.get(id)?.files ?? []).map(f => effectiveDest(f))));
		for (const id of removeUnits) {
			for (const f of byId.get(id)?.files ?? []) {
				const rel = effectiveDest(f);
				if (rel in state.files && !remainingDests.has(rel))
					candidates.push({ rel, mode: f.mode ?? 'copy' });
			}
		}
	}

	const deletions: { rel: string; modified: boolean }[] = [];
	const retained: { rel: string; mode: TrackedFileMode }[] = [];
	for (const { rel, mode } of candidates) {
		if (mode === 'merge-json' || mode === 'append-if-missing') {
			retained.push({ rel, mode });
			continue;
		}
		const abs = join(opts.targetDir, rel);
		// Already hand-deleted: nothing to do, and nothing to warn about either.
		if (!existsSync(abs))
			continue;
		const recorded = state.files[rel];
		const modified = recorded !== undefined && hashBuffer(readFileSync(abs)) !== recorded;
		deletions.push({ rel, modified });
	}

	// package.json back-out. Contributions are computed with the RECORDED options
	// baked in (a react-flavor scaffold contributed react plugins), then reference-
	// counted against what the remaining units still claim by name.
	const resolve = (id: UnitId): Unit | undefined => {
		const u = byId.get(id);
		return u ? applyUnitOptions(u, state.options ?? {}) : undefined;
	};
	const removed = removeUnits.map(resolve).filter((u): u is Unit => u !== undefined);
	const kept = remaining.map(resolve).filter((u): u is Unit => u !== undefined);
	const claimedDeps = new Set(kept.flatMap(u => [...Object.keys(u.dependencies ?? {}), ...Object.keys(u.devDependencies ?? {})]));
	const claimedScripts = new Set(kept.flatMap(u => Object.keys(u.packageJsonPatch?.scripts ?? {})));

	const dependencies = [...new Set(removed.flatMap(u => Object.keys(u.dependencies ?? {})))].filter(n => !claimedDeps.has(n));
	const devDependencies = [...new Set(removed.flatMap(u => Object.keys(u.devDependencies ?? {})))].filter(n => !claimedDeps.has(n));
	const scripts: Record<string, string> = {};
	for (const u of removed) {
		for (const [name, value] of Object.entries(u.packageJsonPatch?.scripts ?? {})) {
			if (!claimedScripts.has(name))
				scripts[name] = value;
		}
	}

	// engines/packageManager are load-bearing beyond the unit (CI reads them, so
	// does corepack); silently unpinning node is the kind of surprise remove
	// exists to avoid. Named as manual steps instead.
	const manualPkg = removed
		.filter(u => u.packageJsonPatch?.engines || u.packageJsonPatch?.packageManager || u.id === 'core-node-version')
		.map(u => `${u.id} contributed engines/packageManager pins to package.json; drop them by hand if you no longer want them.`);

	return {
		units: removeUnits,
		deletions,
		retained,
		pkg: {
			...(dependencies.length > 0 ? { dependencies } : {}),
			...(devDependencies.length > 0 ? { devDependencies } : {}),
			...(Object.keys(scripts).length > 0 ? { scripts } : {}),
		},
		manualPkg,
		notes: removed.map(u => u.removeNotes).filter((n): n is string => Boolean(n)),
	};
}

// Exported for direct testing — pure, no clack.
export function formatRemovalPlan(plan: RemovalPlan): string {
	const lines: string[] = [`Units: ${plan.units.join(', ')}`];
	for (const d of plan.deletions)
		lines.push(`  delete  ${d.rel}${d.modified ? '  (modified since scaffold)' : ''}`);
	for (const r of plan.retained)
		lines.push(`  keep    ${r.rel}  (${r.mode === 'merge-json' ? 'merged content' : 'appended content'})`);
	const pkgBits = [
		...(plan.pkg.dependencies ?? []).map(n => `dependencies.${n}`),
		...(plan.pkg.devDependencies ?? []).map(n => `devDependencies.${n}`),
		...Object.keys(plan.pkg.scripts ?? {}).map(n => `scripts.${n}`),
	];
	if (pkgBits.length > 0)
		lines.push(`  package.json: remove ${pkgBits.join(', ')}`);
	return lines.join('\n');
}

export interface RunRemoveOpts {
	cwd?: string;
	// Skip every prompt. Modified files are KEPT under --yes — the conservative
	// default, since their edits exist nowhere else.
	yes?: boolean;
	dryRun?: boolean;
	force?: boolean;
	// Also remove the units that depend on the target (via implies/requires).
	cascade?: boolean;
}

// The day-2 exit door: doctor tells you what's missing, remove backs a unit out.
// Refuses to strand dependents, previews under --dry-run, hash-checks before
// deleting, and never executes a remedy that isn't "delete a file we wrote" or
// "drop a package.json entry we added".
export async function runRemove(unitId: string, opts: RunRemoveOpts = {}): Promise<number> {
	const cwd = opts.cwd ?? process.cwd();
	const state = readStateFile(cwd);
	if (!state || !state.units.includes(unitId as UnitId)) {
		process.stderr.write(state
			? `unbranded remove: ${unitId} is not tracked here. Installed units: ${state.units.join(', ')}.\n`
			: `unbranded remove: no ${'.unbranded.json'} found — nothing is tracked in this directory.\n`);
		return 1;
	}
	const target = unitId as UnitId;

	const dependents = dependentsOf(target, state.units, UNITS);
	if (dependents.length > 0 && !opts.cascade) {
		process.stderr.write(`unbranded remove: ${dependents.join(', ')} ${dependents.length === 1 ? 'depends' : 'depend'} on ${target}. Remove ${dependents.length === 1 ? 'it' : 'them'} first, or re-run with --cascade to take the whole set out.\n`);
		return 1;
	}
	const removeUnits: UnitId[] = [target, ...(opts.cascade ? dependents : [])];

	intro(opts.dryRun ? 'unbranded remove (dry run)' : 'unbranded remove');

	// Same rationale as init's guard: on a clean tree `git checkout .` undoes
	// every deletion below. Non-interactive runs only warn, so CI can't hang.
	if (!opts.force && !opts.dryRun && await isDirtyGitTree(cwd)) {
		log.warn('Uncommitted changes in the git working tree — a clean tree is your undo button (`git checkout .`) if this removal goes sideways.');
		if (!opts.yes) {
			const proceed = await confirm({ message: 'Remove from a dirty tree anyway?', initialValue: false });
			if (isCancel(proceed))
				return cancelAndExit();
			if (!proceed) {
				cancel('Cancelled.');
				return 0;
			}
		}
	}

	const plan = planRemoval({ targetDir: cwd, state, removeUnits, units: UNITS });
	note(formatRemovalPlan(plan), 'Removal plan');

	if (opts.dryRun) {
		outro('Dry run: nothing removed.');
		return 0;
	}

	if (!opts.yes) {
		const proceed = await confirm({ message: 'Remove?', initialValue: true });
		if (isCancel(proceed))
			return cancelAndExit();
		if (!proceed) {
			cancel('Cancelled.');
			return 0;
		}
	}

	// Modified files hold edits that exist nowhere else. Interactive runs ask per
	// file (default no); --yes keeps them all and says so.
	const toDelete: string[] = [];
	const keptModified: string[] = [];
	for (const d of plan.deletions) {
		if (!d.modified) {
			toDelete.push(d.rel);
			continue;
		}
		if (opts.yes) {
			keptModified.push(d.rel);
			continue;
		}
		const del = await confirm({ message: `${d.rel} was modified since it was scaffolded. Delete it anyway?`, initialValue: false });
		if (isCancel(del))
			return cancelAndExit();
		if (del)
			toDelete.push(d.rel);
		else
			keptModified.push(d.rel);
	}

	for (const rel of toDelete)
		rmSync(join(cwd, rel), { force: true });

	let keptScripts: string[] = [];
	const pkgPath = join(cwd, 'package.json');
	if (existsSync(pkgPath) && (plan.pkg.dependencies || plan.pkg.devDependencies || plan.pkg.scripts)) {
		const raw = readFileSync(pkgPath, 'utf-8');
		const result = removePackageJsonEntries(JSON.parse(raw) as Record<string, unknown>, plan.pkg);
		keptScripts = result.keptScripts;
		writeFileSync(pkgPath, `${JSON.stringify(result.pkg, null, detectIndent(raw))}\n`);
	}

	// Every candidate rel is disowned, deleted or not: a kept file is the user's
	// now, and tracking it against a unit that's gone would just confuse diff.
	applyRemovalToState({
		targetDir: cwd,
		removeUnits,
		removeFiles: [...plan.deletions.map(d => d.rel), ...plan.retained.map(r => r.rel)],
		removeOptionKeys: removeUnits.flatMap(id => (UNITS.find(u => u.id === id)?.options ?? []).map(o => o.key)),
	});

	log.success(`Removed ${removeUnits.join(', ')}: ${toDelete.length} file${toDelete.length === 1 ? '' : 's'} deleted.`);
	if (keptModified.length > 0)
		log.info(`Kept (modified, now untracked): ${keptModified.join(', ')}.`);
	if (keptScripts.length > 0)
		log.info(`Kept scripts you rewrote: ${keptScripts.join(', ')}.`);

	const nextSteps = [
		...plan.retained.map(r => `${r.rel} stays on disk (it carries merged content); review or delete it by hand.`),
		...plan.manualPkg,
		...plan.notes,
	];
	if (nextSteps.length > 0)
		note(nextSteps.map(s => `• ${s}`).join('\n'), 'Next steps');

	outro('Done.');
	return 0;
}
