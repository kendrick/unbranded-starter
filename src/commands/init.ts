import { cancel, confirm, groupMultiselect, intro, isCancel, log, note, outro } from '@clack/prompts';
import { detectPm, type Pm } from '../detect/pm';
import { detectTarget } from '../detect/target';
import { UNITS } from '../manifest/index';
import { resolveSelection } from '../manifest/resolve';
import type { Category, Unit, UnitId } from '../manifest/types';

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

	note(formatPlan(resolution.ids, resolution.auto, UNITS, pm), 'Plan');

	const proceed = await confirm({ message: 'Apply?', initialValue: true });
	if (isCancel(proceed) || !proceed) {
		cancel('Cancelled.');
		return;
	}

	// File copy + package.json merge + install + post-install land in steps
	// 7 and 8. For now the confirm is a no-op so users can walk the prompt
	// flow end to end.
	log.warn('Apply is a no-op until step 7. File copy and install land next.');

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

function formatPlan(ids: UnitId[], auto: UnitId[], units: Unit[], pm: Pm | null): string {
	const byId = new Map(units.map((u) => [u.id, u]));
	const lines: string[] = [];

	for (const id of ids) {
		const u = byId.get(id);
		if (!u) continue;
		const autoTag = auto.includes(id) ? ' (auto)' : '';
		lines.push(`  • ${u.label}${autoTag}`);
	}

	const fileCount = ids.reduce((n, id) => n + (byId.get(id)?.files.length ?? 0), 0);
	const depCount = ids.reduce((n, id) => {
		const u = byId.get(id);
		return n + Object.keys(u?.dependencies ?? {}).length + Object.keys(u?.devDependencies ?? {}).length;
	}, 0);

	lines.push('');
	const installLine = pm ? `install via ${pm}` : 'no install (no package.json)';
	lines.push(`${ids.length} units · ${fileCount} files · ${depCount} deps · ${installLine}`);

	return lines.join('\n');
}
