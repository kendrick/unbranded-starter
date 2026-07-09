import type { Pm } from '../detect/pm';
import type { Unit, UnitId } from '../manifest/types';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// opt-monorepo copies its own pnpm-workspace.yaml (allowlist included), so the
// scaffold must not also seed one, or it collides on the same path.
const MONOREPO_UNIT_ID: UnitId = 'opt-monorepo';

// Unit -> the packages in its dependency tree that run a build script pnpm has
// to be told to allow. These are usually TRANSITIVE (core-vitest declares
// `vitest`, which pulls `esbuild`), so this can't be read off a unit's own
// declared deps. It's a hand-kept map, and the v11 acceptance e2e pins its
// contents by installing each preset and allowlisting exactly what pnpm reports.
// On pnpm 11 an un-allowlisted build fails `pnpm install` outright
// (ERR_PNPM_IGNORED_BUILDS), so any pnpm scaffold pulling one of these has to
// carry the approval or its very first install dies.
export const BUILD_SCRIPT_DEPS: Partial<Record<UnitId, readonly string[]>> = {
	'core-vitest': ['esbuild'],
};

// The build-script packages a selection pulls, plus the unit to attribute the
// computed file to. Deps are deduped and sorted so the written file is stable;
// the owner is the first offender in selection order, since the file is
// genuinely cross-unit and the state needs one real id to hang attribution on.
export function collectBuildScriptDeps(
	units: Unit[],
	map: Partial<Record<UnitId, readonly string[]>> = BUILD_SCRIPT_DEPS,
): { deps: string[]; owner: UnitId | null } {
	const deps = new Set<string>();
	let owner: UnitId | null = null;
	for (const unit of units) {
		const pkgs = map[unit.id];
		if (pkgs?.length) {
			owner ??= unit.id;
			for (const pkg of pkgs)
				deps.add(pkg);
		}
	}
	return { deps: [...deps].sort(), owner };
}

// Scoped names like `@playwright/test` start with a YAML reserved indicator, so
// they have to be quoted in both the list and the map; plain names stay bare.
function yamlScalar(name: string): string {
	return /^[\w.-]+$/.test(name) ? name : `'${name}'`;
}

function pnpmMajor(version: string | null | undefined): number | null {
	if (!version)
		return null;
	const major = Number.parseInt(version.split('.')[0] ?? '', 10);
	return Number.isNaN(major) ? null : major;
}

// The build-script allowlist as a pnpm-workspace.yaml. Both keys ride together
// because pnpm split them across majors (pnpm 10 reads the
// `onlyBuiltDependencies` list, pnpm 11 the `allowBuilds` map), and one file has
// to serve whichever the user runs. `withPackages` adds a single-package stub:
// pnpm 10 rejects a workspace file that has no `packages` field, while pnpm 11
// treats the file as plain project settings and needs no stub. Default off, so
// a modern scaffold gets the clean settings-only form.
export function buildPnpmWorkspace(deps: readonly string[], opts: { withPackages?: boolean } = {}): string {
	const list = deps.map(dep => `  - ${yamlScalar(dep)}`).join('\n');
	const map = deps.map(dep => `  ${yamlScalar(dep)}: true`).join('\n');
	const lines = [
		'# unbranded wrote this so `pnpm install` can build the native packages your',
		'# tooling needs, such as esbuild. pnpm blocks build scripts unless a package',
		'# is on the allowlist below; on pnpm 11 an un-approved build stops the install',
		'# cold. Commit this file so every install, yours and CI\'s, agrees.',
		'#',
		'# pnpm 10 reads onlyBuiltDependencies, pnpm 11 reads allowBuilds. Both are here',
		'# on purpose. Add a package to both to approve its build, or drop it to block one.',
		'',
	];
	if (opts.withPackages) {
		lines.push(
			'# pnpm 10 rejects a workspace file with no packages list; `.` is just this one',
			'# package, not a monorepo. pnpm 11 drops the requirement. Unquoted on purpose:',
			'# the ESLint config a scaffold ships flags a needlessly quoted scalar.',
			'packages:',
			'  - .',
			'',
		);
	}
	lines.push('onlyBuiltDependencies:', list, '', 'allowBuilds:', map, '');
	return lines.join('\n');
}

// Writes the settings file when the run warrants it: pnpm, an offender in the
// selection, no opt-monorepo (it ships its own), and no pnpm-workspace.yaml to
// clobber. Returns the computed write to record, or null when a gate isn't met.
// Must run BEFORE unbranded's own install spawn so that install sees the file.
export function seedPnpmWorkspace(opts: { targetDir: string; pm: Pm | null; pmVersion?: string | null; units: Unit[] }): { path: string; unit: UnitId } | null {
	if (opts.pm !== 'pnpm')
		return null;
	if (opts.units.some(unit => unit.id === MONOREPO_UNIT_ID))
		return null;
	const { deps, owner } = collectBuildScriptDeps(opts.units);
	if (deps.length === 0 || owner === null)
		return null;
	const dest = join(opts.targetDir, 'pnpm-workspace.yaml');
	// Never overwrite a workspace file the user already maintains. We can't
	// safely merge without parsing YAML, so we step aside rather than clobber.
	if (existsSync(dest))
		return null;
	// The packages stub is only needed on pnpm 10; a version we can't identify
	// gets it too, since the stub form is the one that works on every pnpm.
	const major = pnpmMajor(opts.pmVersion);
	const withPackages = major === null || major < 11;
	writeFileSync(dest, buildPnpmWorkspace(deps, { withPackages }));
	return { path: dest, unit: owner };
}
