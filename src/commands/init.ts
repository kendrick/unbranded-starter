import type { Pm } from '../detect/pm';
import type { CopyResult } from '../fs/copy';
import type { Unit, UnitId } from '../manifest/types';
import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import { cancel, confirm, groupMultiselect, intro, isCancel, log, note, outro } from '@clack/prompts';
import { loadConfig } from '../config/load';
import { detectPm } from '../detect/pm';
import { detectTarget } from '../detect/target';
import { copyFileOp } from '../fs/copy';
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
}

export async function runInit(opts: RunInitOpts = {}): Promise<void> {
	// Loading config first means we fail with a clear error before prompting,
	// rather than mid-flow after the user already started picking things.
	const config = opts.configPath
		? loadConfig(opts.configPath, new Set(UNITS.map(u => u.id)))
		: null;

	// The flag wins over the recipe field, so `--config r.json --latest` works.
	const latest = opts.latest || config?.versions === 'latest';

	intro(config ? 'unbranded (--config)' : 'unbranded');

	const target = await detectTarget({ projectName: config?.projectName });
	log.info(`Target: ${target.dir} (${target.mode})`);

	const pm = await detectPm(target.dir, { override: config?.pm, mode: target.mode });
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

	// In config mode the user has already opted in by supplying the recipe.
	// Asking again would just slow CI down for no benefit.
	if (!config) {
		const proceed = await confirm({ message: 'Apply?', initialValue: true });
		if (isCancel(proceed))
			return cancelAndExit();
		if (!proceed) {
			cancel('Cancelled.');
			return;
		}
	}

	const projectName = target.mode === 'new' ? basename(target.dir) : undefined;
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

	const copied = copyResults.filter(r => r.action === 'copied').length;
	const overwrote = copyResults.filter(r => r.action === 'overwrote').length;
	const skipped = copyResults.filter(r => r.action === 'skipped').length;
	log.success(`Files: ${copied} written, ${overwrote} overwritten, ${skipped} skipped.`);

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
