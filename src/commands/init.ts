import { basename } from 'node:path';
import { cancel, confirm, groupMultiselect, intro, isCancel, log, note, outro } from '@clack/prompts';
import { detectPm, type Pm } from '../detect/pm';
import { detectTarget } from '../detect/target';
import { copyFileOp, type CopyResult } from '../fs/copy';
import { runPostInstalls } from '../install/post';
import { writeAndInstall } from '../install/run';
import { UNITS } from '../manifest/index';
import { resolveSelection } from '../manifest/resolve';
import type { Category, Unit, UnitId } from '../manifest/types';
import { PKG_ROOT } from '../util/paths';

// Human-readable group headers for the multiselect. Falls back to the raw
// category key if a future category lands here without an explicit label.
const CATEGORY_LABELS: Record<Category, string> = {
	lint: 'Linting',
	style: 'Styles',
	types: 'TypeScript',
	test: 'Testing',
	e2e: 'End-to-end',
	monorepo: 'Monorepo',
	ui: 'UI',
	git: 'Git hooks',
};

export async function runInit(): Promise<void> {
	intro('unbranded');

	const target = await detectTarget();
	log.info(`Target: ${target.dir} (${target.mode})`);

	const pm = await detectPm(target.dir);
	log.info(pm ? `Package manager: ${pm}` : 'No package.json — files will be written; install will be skipped.');

	const selection = await promptSelection(UNITS);
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

	const byId = new Map(UNITS.map((u) => [u.id, u]));
	const selectedUnits = resolution.ids
		.map((id) => byId.get(id))
		.filter((u): u is Unit => u !== undefined);

	note(formatPlan(selectedUnits, resolution.auto, pm), 'Plan');

	const proceed = await confirm({ message: 'Apply?', initialValue: true });
	if (isCancel(proceed) || !proceed) {
		cancel('Cancelled.');
		return;
	}

	const projectName = target.mode === 'new' ? basename(target.dir) : undefined;
	const copyResults: CopyResult[] = [];
	for (const unit of selectedUnits) {
		for (const file of unit.files) {
			copyResults.push(await copyFileOp(file, {
				pkgRoot: PKG_ROOT,
				targetDir: target.dir,
				projectName,
			}));
		}
	}

	const copied = copyResults.filter((r) => r.action === 'copied').length;
	const overwrote = copyResults.filter((r) => r.action === 'overwrote').length;
	const skipped = copyResults.filter((r) => r.action === 'skipped').length;
	log.success(`Files: ${copied} written, ${overwrote} overwritten, ${skipped} skipped.`);

	const installResult = await writeAndInstall({
		targetDir: target.dir,
		pm,
		units: selectedUnits,
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

	// Post-installs only make sense if the install step actually ran. Without
	// node_modules the husky/playwright binaries aren't on PATH yet.
	if (pm && installResult.installed) {
		await runPostInstalls({
			targetDir: target.dir,
			pm,
			units: selectedUnits,
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
		cancel('Cancelled.');
		return process.exit(0);
	}
	return result;
}

function formatPlan(units: Unit[], auto: UnitId[], pm: Pm | null): string {
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
	lines.push(`${units.length} units · ${fileCount} files · ${depCount} deps · ${installLine}`);

	return lines.join('\n');
}

function formatNoPmNextSteps(targetDir: string, units: Unit[]): string {
	const deps = new Set<string>();
	const devDeps = new Set<string>();
	for (const u of units) {
		for (const name of Object.keys(u.dependencies ?? {})) deps.add(name);
		for (const name of Object.keys(u.devDependencies ?? {})) devDeps.add(name);
	}

	const lines: string[] = [
		'Files written. Install was skipped because no package.json was detected.',
		'',
		`  cd ${targetDir}`,
		'  npm init -y           # or pnpm init / yarn init / bun init',
	];
	if (deps.size > 0) lines.push(`  npm install ${[...deps].sort().join(' ')}`);
	if (devDeps.size > 0) lines.push(`  npm install -D ${[...devDeps].sort().join(' ')}`);
	return lines.join('\n');
}
