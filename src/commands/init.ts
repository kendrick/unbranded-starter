import type { InlineFlags } from '../config/load';
import type { Pm } from '../detect/pm';
import type { CopyResult, FilePlan, PlanOutcome } from '../fs/copy';
import type { Unit, UnitId } from '../manifest/types';
import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import { cancel, confirm, groupMultiselect, intro, isCancel, log, note, outro } from '@clack/prompts';
import { assertValidPm, loadConfig, resolveConfig } from '../config/load';
import { detectPm } from '../detect/pm';
import { detectTarget } from '../detect/target';
import { copyFileOp, planFileOp, renderPlanDiff } from '../fs/copy';
import { maybeInitGit } from '../install/git';
import { runPostInstalls } from '../install/post';
import { writeAndInstall } from '../install/run';
import { CATEGORY_LABELS } from '../manifest/categories';
import { UNITS } from '../manifest/index';
import { resolveSelection } from '../manifest/resolve';
import { cancelAndExit } from '../util/cancel';
import { PKG_ROOT } from '../util/paths';

export interface RunInitOpts {
	configPath?: string;
	// From the `--latest` flag. Overrides the recipe's `versions` field.
	latest?: boolean;
	// Inline flags for a non-interactive run without a recipe file. When both a
	// recipe and inline flags are present, inline wins per field.
	inline?: InlineFlags;
	// `--dry-run`: resolve and report what each FileOp would do, then stop
	// before any write or install. `--diff` widens the report with the unified
	// patch for every file that would change.
	dryRun?: boolean;
	diff?: boolean;
}

export async function runInit(opts: RunInitOpts = {}): Promise<void> {
	const inline = opts.inline ?? {};

	// --yes means "don't prompt, just apply". With no selection there's nothing
	// to apply and no prompt is allowed to fill the gap, so fail before any IO.
	if (inline.yes && inline.units === undefined && !opts.configPath) {
		throw new Error('`--yes` needs `--units <ids>` to know what to install, or point at a recipe with `--config <file>`.');
	}

	// Validate --pm up front so a bad value fails fast in every mode, not only
	// once a full config gets assembled. The assertion narrows the raw flag
	// string to `Pm | null` so it can feed detectPm's override below.
	let pmOverride: Pm | null | undefined;
	if (inline.pm !== undefined) {
		assertValidPm(inline.pm);
		pmOverride = inline.pm;
	}

	const known = new Set(UNITS.map(u => u.id));

	// Loading config first means we fail with a clear error before prompting,
	// rather than mid-flow after the user already started picking things.
	const fileConfig = opts.configPath ? loadConfig(opts.configPath, known) : null;

	// A merged config drives every non-interactive path: a recipe file, inline
	// --units, or --yes. A bare interactive run leaves it null.
	const nonInteractive = fileConfig !== null || inline.units !== undefined || Boolean(inline.yes);
	const config = nonInteractive ? resolveConfig(fileConfig, inline, known) : null;

	// The flag wins over the recipe field, so `--config r.json --latest` works.
	const latest = opts.latest || config?.versions === 'latest';

	// Supplying a recipe or passing --yes is the opt-in, so skip the Apply
	// confirm. Inline --units on its own still gets it, which keeps a flag typo
	// catchable before anything is written.
	const skipApply = Boolean(opts.configPath) || Boolean(inline.yes);

	intro(config ? 'unbranded (non-interactive)' : 'unbranded');

	const target = await detectTarget({ projectName: config?.projectName });
	log.info(`Target: ${target.dir} (${target.mode})`);

	// --pm rides the existing detectPm override channel, so it skips the PM
	// prompt in interactive runs too, not just config mode. Inline --pm wins
	// over the recipe's pm; when neither is set the override is undefined and
	// detection runs exactly as before.
	const pm = await detectPm(target.dir, { override: pmOverride ?? fileConfig?.pm, mode: target.mode });
	log.info(pm ? `Package manager: ${pm}` : 'No package.json — files will be written; install will be skipped.');

	const selection = config ? config.units : await promptSelection(UNITS);
	if (selection.length === 0) {
		outro('Nothing selected.');
		return;
	}

	const resolution = resolveSelection(selection, UNITS);
	if (resolution.kind === 'missing-required') {
		log.error(`${resolution.unit} requires ${resolution.needs.join(', ')}, which weren't selected.`);
		process.exit(1);
	}
	if (resolution.kind === 'conflict') {
		log.error(`${resolution.pair[0]} and ${resolution.pair[1]} can't both be selected.`);
		process.exit(1);
	}

	const byId = new Map(UNITS.map(u => [u.id, u]));
	const selectedUnits = resolution.ids
		.map(id => byId.get(id))
		.filter((u): u is Unit => u !== undefined);

	note(formatPlan(selectedUnits, resolution.auto, pm, latest), 'Plan');

	const projectName = target.mode === 'new' ? basename(target.dir) : undefined;

	// --dry-run reports the same resolved plan a real run would apply, then
	// stops before the first write. It sits ahead of the Apply gate so it works
	// the same whether the selection came from a prompt or a --config recipe.
	if (opts.dryRun) {
		const plans = selectedUnits.flatMap(unit =>
			unit.files.map(file => planFileOp(file, { pkgRoot: PKG_ROOT, targetDir: target.dir, projectName })),
		);
		note(formatDryRun(plans, opts.diff ?? false), 'Dry run (no files written)');
		log.success(formatDryRunSummary(plans));
		outro('Dry run: nothing written.');
		return;
	}

	// A recipe or --yes already opts in; asking again would just slow CI down.
	// Inline --units without --yes still confirms, so a typo'd id is catchable.
	if (!skipApply) {
		const proceed = await confirm({ message: 'Apply?', initialValue: true });
		if (isCancel(proceed))
			return cancelAndExit();
		if (!proceed) {
			cancel('Cancelled.');
			return;
		}
	}

	const copyResults: CopyResult[] = [];
	for (const unit of selectedUnits) {
		for (const file of unit.files) {
			copyResults.push(await copyFileOp(file, {
				pkgRoot: PKG_ROOT,
				targetDir: target.dir,
				projectName,
				onConflict: config?.onConflict,
			}));
		}
	}

	const count = (action: CopyResult['action']): number => copyResults.filter(r => r.action === action).length;
	log.success(
		`Files: ${count('copied')} written, ${count('overwrote')} overwritten, `
		+ `${count('merged')} merged, ${count('appended')} appended, ${count('skipped')} skipped.`,
	);

	const installResult = await writeAndInstall({
		targetDir: target.dir,
		pm,
		units: selectedUnits,
		latest,
	});

	if (installResult.cancelled) {
		log.warn(`Install interrupted. Re-run \`${pm} install\` in ${target.dir} to finish.`);
	}
	else if (installResult.error) {
		log.error(installResult.error);
	}
	else if (!pm) {
		log.message(formatNoPmNextSteps(target.dir, selectedUnits));
	}

	// New projects get a git repo before post-installs run: husky's post-install
	// gates on `.git`, so initializing here (not after) is what lets husky wire up
	// its hooks in the same pass. Augment targets already have their own repo.
	if (target.mode === 'new') {
		await maybeInitGit({ targetDir: target.dir, plan: config?.git });
	}

	// Post-installs only make sense if the install step actually ran. Without
	// node_modules the husky/playwright binaries aren't on PATH yet.
	if (pm && installResult.installed) {
		await runPostInstalls({
			targetDir: target.dir,
			pm,
			units: selectedUnits,
			auto: config?.postInstall,
		});
	}

	outro('Done.');
}

async function promptSelection(units: Unit[]): Promise<UnitId[]> {
	const grouped: Record<string, { value: UnitId; label: string; hint?: string }[]> = {};
	for (const unit of units) {
		const header = CATEGORY_LABELS[unit.category] ?? unit.category;
		(grouped[header] ??= []).push({
			value: unit.id,
			label: unit.label,
			hint: unit.description,
		});
	}

	const result = await groupMultiselect<UnitId>({
		message: 'What do you want to install?',
		options: grouped,
		required: false,
	});

	if (isCancel(result)) {
		return cancelAndExit();
	}
	return result;
}

function formatPlan(units: Unit[], auto: UnitId[], pm: Pm | null, latest: boolean): string {
	const lines: string[] = [];

	for (const u of units) {
		const autoTag = auto.includes(u.id) ? ' (auto)' : '';
		lines.push(`  • ${u.label}${autoTag}`);
	}

	const fileCount = units.reduce((n, u) => n + u.files.length, 0);
	const depCount = units.reduce(
		(n, u) => n + Object.keys(u.dependencies ?? {}).length + Object.keys(u.devDependencies ?? {}).length,
		0,
	);

	lines.push('');
	const installLine = pm ? `install via ${pm}` : 'no install (no package.json)';
	lines.push(`${units.length} units · ${fileCount} files · ${depCount} deps (${latest ? 'latest' : 'pinned'}) · ${installLine}`);

	return lines.join('\n');
}

// Left-padded verbs so the paths line up in a column, matching the tone of the
// real run's per-file reporting. Order follows the plan list, not the outcome,
// so the report reads top-to-bottom the way the files were resolved.
const PLAN_LABELS: Record<PlanOutcome, string> = {
	create: 'would create',
	merge: 'would merge',
	append: 'would append',
	skip: 'identical',
	conflict: 'conflict',
};

function formatDryRun(plans: FilePlan[], withDiff: boolean): string {
	const width = Math.max(...Object.values(PLAN_LABELS).map(l => l.length));
	const lines: string[] = [];

	for (const plan of plans) {
		lines.push(`${PLAN_LABELS[plan.outcome].padEnd(width)}  ${plan.rel}`);
		if (withDiff) {
			const diff = renderPlanDiff(plan);
			if (diff)
				lines.push(diff);
		}
	}

	return lines.join('\n');
}

function formatDryRunSummary(plans: FilePlan[]): string {
	const count = (outcome: PlanOutcome): number => plans.filter(p => p.outcome === outcome).length;
	// Mirrors the real run's `Files: N written…` line, swapped to would-phrasing.
	// Conflicts get their own tail count since dry-run reports them instead of
	// resolving them into a write or a skip.
	return (
		`Would: ${count('create')} written, ${count('merge')} merged, `
		+ `${count('append')} appended, ${count('skip')} skipped, ${count('conflict')} conflicts.`
	);
}

function formatNoPmNextSteps(targetDir: string, units: Unit[]): string {
	const deps = new Set<string>();
	const devDeps = new Set<string>();
	for (const u of units) {
		for (const name of Object.keys(u.dependencies ?? {})) deps.add(name);
		for (const name of Object.keys(u.devDependencies ?? {})) devDeps.add(name);
	}

	// writeAndInstall seeds a package.json even when install is skipped, so by
	// the time we print this one already exists on disk. Suggesting `npm init`
	// then would clobber the seeded manifest — only offer it when there's
	// genuinely nothing to install against.
	const hasPkg = existsSync(join(targetDir, 'package.json'));

	const lines: string[] = [
		hasPkg
			? 'Files written. Install was skipped; run install to finish.'
			: 'Files written. Install was skipped because no package.json was detected.',
		'',
		`  cd ${targetDir}`,
	];
	if (!hasPkg)
		lines.push('  npm init -y           # or pnpm init / yarn init / bun init');
	if (deps.size > 0)
		lines.push(`  npm install ${[...deps].sort().join(' ')}`);
	if (devDeps.size > 0)
		lines.push(`  npm install -D ${[...devDeps].sort().join(' ')}`);
	return lines.join('\n');
}
