import type { InlineFlags } from '../config/load';
import type { Pm } from '../detect/pm';
import type { CopyResult, FilePlan, PlanOutcome } from '../fs/copy';
import type { Unit, UnitId, UnitOption } from '../manifest/types';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { cancel, confirm, groupMultiselect, intro, isCancel, log, note, outro, select } from '@clack/prompts';
import { assertValidPm, loadConfig, resolveConfig } from '../config/load';
import { buildRecipe, serializeRecipe } from '../config/recipe';
import { detectPm } from '../detect/pm';
import { detectTarget } from '../detect/target';
import { copyFileOp, planFileOp, renderPlanDiff } from '../fs/copy';
import { isDirtyGitTree, maybeInitGit } from '../install/git';
import { runPostInstalls } from '../install/post';
import { writeAndInstall } from '../install/run';
import { CATEGORY_LABELS } from '../manifest/categories';
import { detectEslintFlavor } from '../manifest/eslint-config';
import { UNITS } from '../manifest/index';
import { applyUnitOptions, buildOptionSchema } from '../manifest/options';
import { resolveSelection } from '../manifest/resolve';
import { writeStateFile } from '../state/state';
import { cancelAndExit } from '../util/cancel';
import { readPackageJson } from '../util/package-json';
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
	// `--target <dir>`: scaffold against this directory instead of the cwd,
	// already resolved to an absolute path in cli.ts. Relative `--config` paths
	// still resolve against the invocation cwd, since loadConfig runs before this
	// is threaded into detection and no process.chdir happens.
	targetDir?: string;
	// `--force`: skip the dirty-tree guard. Rides its own channel (like --latest)
	// rather than InlineFlags; a recipe's `force` field is the config-mode twin.
	force?: boolean;
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
	// The option surface (core-eslint's flavor today) so a recipe's `options` map
	// and the `--units id:value` inline syntax validate against the manifest.
	const optionSchema = buildOptionSchema(UNITS);

	// Loading config first means we fail with a clear error before prompting,
	// rather than mid-flow after the user already started picking things.
	const fileConfig = opts.configPath ? loadConfig(opts.configPath, known, optionSchema) : null;

	// A merged config drives every non-interactive path: a recipe file, inline
	// --units, or --yes. A bare interactive run leaves it null.
	const nonInteractive = fileConfig !== null || inline.units !== undefined || Boolean(inline.yes);
	const config = nonInteractive ? resolveConfig(fileConfig, inline, known, optionSchema) : null;

	// The flag wins over the recipe field, so `--config r.json --latest` works.
	const latest = opts.latest || config?.versions === 'latest';

	// Supplying a recipe or passing --yes is the opt-in, so skip the Apply
	// confirm. Inline --units on its own still gets it, which keeps a flag typo
	// catchable before anything is written.
	const skipApply = Boolean(opts.configPath) || Boolean(inline.yes);

	intro(config ? 'unbranded (non-interactive)' : 'unbranded');

	const target = await detectTarget({ projectName: config?.projectName, cwd: opts.targetDir });
	log.info(`Target: ${target.dir} (${target.mode})`);

	// On a clean tree `git checkout .` is a full undo of everything this run
	// writes — the safety net augment users lean on. A dirty tree has no such
	// net, so warn before the first write, never after. Only augment mode has a
	// pre-existing repo; new mode's dir isn't a repo yet. --force (or a recipe
	// `force`) opts out. Non-interactive runs (skipApply) only warn so CI can't
	// hang on a prompt; interactive runs confirm, and a cancel exits 130.
	const forced = Boolean(opts.force) || Boolean(config?.force);
	if (!forced && target.mode === 'augment' && await isDirtyGitTree(target.dir)) {
		log.warn('Uncommitted changes in the git working tree — a clean tree is your undo button (`git checkout .`) if this scaffold goes sideways.');
		if (!skipApply) {
			const proceed = await confirm({ message: 'Write into a dirty tree anyway?', initialValue: false });
			if (isCancel(proceed))
				return cancelAndExit();
			if (!proceed) {
				cancel('Cancelled.');
				return;
			}
		}
	}

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

	// Resolve each selected unit's options (core-eslint's flavor today) to a
	// concrete value, then bake them in. A recipe/inline value wins; otherwise an
	// interactive run prompts and a non-interactive one takes the environment
	// default. skipApply gates the prompt the same way it gates the Apply confirm,
	// so a --yes/recipe run never blocks on a flavor question in CI.
	const optionSelections = await resolveUnitOptions(selectedUnits, config?.options, !skipApply, target.dir);
	const units = selectedUnits.map(unit => applyUnitOptions(unit, optionSelections));

	note(formatPlan(units, resolution.auto, resolution.requiredBy, pm, latest), 'Plan');

	const projectName = target.mode === 'new' ? basename(target.dir) : undefined;

	// --dry-run reports the same resolved plan a real run would apply, then
	// stops before the first write. It sits ahead of the Apply gate so it works
	// the same whether the selection came from a prompt or a --config recipe.
	if (opts.dryRun) {
		const plans = units.flatMap(unit =>
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
	for (const unit of units) {
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
		units,
		latest,
	});

	// Record what landed so `unbranded diff` can later tell a user's edits from a
	// stale template. Runs after writeAndInstall so the files it computes outside
	// the copy loop (.nvmrc, .vscode/extensions.json) get hashed too; those land
	// before the install spawn, so a cancelled or failed install still leaves a
	// complete file map. A --dry-run returns earlier and never records state.
	writeStateFile({
		targetDir: target.dir,
		units: resolution.ids,
		results: copyResults,
		extraWrites: installResult.computedWrites,
	});

	if (installResult.cancelled) {
		log.warn(`Install interrupted. Re-run \`${pm} install\` in ${target.dir} to finish.`);
	}
	else if (installResult.error) {
		log.error(installResult.error);
	}
	else if (!pm) {
		log.message(formatNoPmNextSteps(target.dir, units));
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
			units,
			auto: config?.postInstall,
		});
	}

	// Explore interactively once, then replay everywhere: offer to freeze this run
	// as a recipe. Only on a fully interactive run — a config or inline-flag run
	// already has its source of truth, so re-emitting one is circular. Defaults to
	// No so nobody who doesn't care pays more than one Enter.
	const usedInlineFlags = inline.units !== undefined || inline.pm !== undefined
		|| inline.onConflict !== undefined || inline.postInstall !== undefined || Boolean(inline.yes);
	if (config === null && !usedInlineFlags) {
		const save = await confirm({ message: 'Save this configuration as a recipe? (recipe.json)', initialValue: false });
		if (isCancel(save))
			return cancelAndExit();
		if (save) {
			const version = (JSON.parse(readFileSync(join(PKG_ROOT, 'package.json'), 'utf-8')) as { version: string }).version;
			const dest = join(target.dir, 'recipe.json');
			writeFileSync(dest, serializeRecipe(buildRecipe({ ids: resolution.ids, pm, latest, projectName, options: optionSelections, version })));
			log.success(`Saved ${dest}. Replay it with \`unbranded --config recipe.json\`.`);
		}
	}

	outro('Done.');
}

// Resolve every selected unit's options to a concrete value. Precedence: a value
// already supplied by the recipe/inline flags wins; otherwise an interactive run
// prompts (defaulted from the environment), and a non-interactive one takes that
// same environment default. Returns the full map so applyUnitOptions can bake it
// in and save-recipe can record exactly what was chosen.
async function resolveUnitOptions(
	units: Unit[],
	fromConfig: Record<string, string> | undefined,
	interactive: boolean,
	targetDir: string,
): Promise<Record<string, string>> {
	const selections: Record<string, string> = { ...fromConfig };

	for (const unit of units) {
		for (const option of unit.options ?? []) {
			if (selections[option.key] !== undefined)
				continue;

			const fallback = optionDefault(option, targetDir);
			if (!interactive) {
				selections[option.key] = fallback;
				continue;
			}

			const chosen = await select<string>({
				message: `${unit.label}: ${option.label}`,
				options: option.choices.map(c => ({ value: c.value, label: c.label, hint: c.hint })),
				initialValue: fallback,
			});
			if (isCancel(chosen))
				return cancelAndExit();
			selections[option.key] = chosen;
		}
	}

	return selections;
}

// The one place an option default is computed from the environment rather than a
// static value. F-14 will fold this into the option schema; for now the only
// option is core-eslint's flavor, defaulted by sniffing the target's dependencies
// (a repo that pulls next/react wants that flavor, everything else gets base).
function optionDefault(option: UnitOption, targetDir: string): string {
	if (option.key === 'eslintFlavor')
		return detectEslintFlavor(targetDependencyNames(targetDir));
	return option.default;
}

function targetDependencyNames(targetDir: string): string[] {
	const read = readPackageJson(targetDir);
	if (read.kind !== 'ok')
		return [];
	return [...Object.keys(read.pkg.dependencies ?? {}), ...Object.keys(read.pkg.devDependencies ?? {})];
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

// Exported for direct testing — pure, no clack. `requiredBy` maps each auto-added
// unit to the unit that pulled it in (resolver's nearest-requirer), so the plan can
// explain a surprise entry rather than just tagging it "(auto)".
export function formatPlan(
	units: Unit[],
	auto: UnitId[],
	requiredBy: Partial<Record<UnitId, UnitId>>,
	pm: Pm | null,
	latest: boolean,
): string {
	const lines: string[] = [];
	const labelById = new Map(units.map(u => [u.id, u.label]));

	for (const u of units) {
		const requirer = requiredBy[u.id];
		const requirerLabel = requirer ? labelById.get(requirer) : undefined;
		// Bare "(auto)" is a defensive fallback: auto and requiredBy come from the
		// same resolver call, so a missing attribution shouldn't happen, but printing
		// "required by undefined" would be worse than saying nothing.
		const autoTag = auto.includes(u.id)
			? (requirerLabel ? ` (auto — required by ${requirerLabel})` : ' (auto)')
			: '';
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
