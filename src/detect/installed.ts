import type { Unit, UnitId } from '../manifest/types';
import type { PackageJson } from '../util/package-json';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readStateFile } from '../state/state';
import { readPackageJson } from '../util/package-json';
import { effectiveDest, hasDep, hasNodeVersionPin } from './signals';

// Which of `units` already look installed in `cwd`. Read-only and best-effort: the
// result badges the augment picker as a hint, never a gate, so a miss just leaves an
// un-badged row the user can still select. That asymmetry is why every probe here
// prefers under-claiming to a false badge.
export function detectInstalledUnits(opts: { cwd: string; units: Unit[] }): Set<UnitId> {
	const { cwd, units } = opts;

	// The state file wins when present: it records the exact resolved ids a prior
	// unbranded run wrote, auto-added units included, so those badge correctly. The
	// accepted trade-off is that tooling a user wired up by hand after scaffolding
	// won't badge — we only know what we wrote — and re-applying a unit is harmless,
	// so under-badging is the safe way to be wrong.
	const known = new Set(units.map(u => u.id));
	const state = readStateFile(cwd);
	if (state)
		return new Set(state.units.filter(id => known.has(id)));

	// No state file: fall back to probing the filesystem. Read package.json once.
	const read = readPackageJson(cwd);
	const pkg: PackageJson = read.kind === 'ok' ? read.pkg : {};

	const installed = new Set<UnitId>();
	for (const unit of units) {
		if (isPresent(unit, cwd, pkg))
			installed.add(unit.id);
	}
	return installed;
}

function isPresent(unit: Unit, cwd: string, pkg: PackageJson): boolean {
	// Side channels for the three units whose footprint isn't a static file we ship —
	// their config is computed or varies by option, so `unit.files` can't answer.
	if (unit.id === 'core-tailwind')
		// Tailwind v4 is CSS-only; no config lands, the dependency is the only signal.
		return hasDep(pkg, 'tailwindcss');
	if (unit.id === 'core-node-version')
		// .nvmrc and the package.json pins are computed at write time, never shipped.
		return hasNodeVersionPin(cwd, pkg);
	if (unit.id === 'core-eslint')
		// Post-#27 the config is delivered by a flavor option, not unit.files, so stat it.
		return existsSync(join(cwd, 'eslint.config.mjs'));

	// Default: installed only when every file the unit ships already exists. `every`,
	// not `some` — a half-landed unit isn't really installed, and under-claiming is
	// safe since the picker still lets the user (re-)select it. Accepted false positive:
	// opt-vscode badges off a user's own .vscode/settings.json. That's fine; it's a hint.
	return unit.files.length > 0 && unit.files.every(f => existsSync(join(cwd, effectiveDest(f))));
}
