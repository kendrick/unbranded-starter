import type { Unit, UnitId } from '../manifest/types';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BUILD_SCRIPT_DEPS, buildPnpmWorkspace, collectBuildScriptDeps, seedPnpmWorkspace } from './pnpm-builds';

function unit(id: UnitId): Unit {
	return { id, category: 'test', label: '', description: '', files: [] };
}

describe('collectBuildScriptDeps', () => {
	// A synthetic map keeps the reducer's logic (dedupe, sort, owner-precedence)
	// honest without pinning it to whichever real units happen to build today.
	const map: Partial<Record<UnitId, readonly string[]>> = {
		'core-vitest': ['esbuild'],
		'core-tailwind': ['lightningcss'],
		'opt-playwright': ['esbuild', '@playwright/test'],
	};

	it('collects the build-script packages the selection pulls', () => {
		expect(collectBuildScriptDeps([unit('core-vitest')], map).deps).toEqual(['esbuild']);
	});

	it('returns no deps and no owner when nothing in the selection builds', () => {
		expect(collectBuildScriptDeps([unit('core-eslint')], map)).toEqual({ deps: [], owner: null });
	});

	it('dedupes across units and sorts for a stable file', () => {
		// core-vitest and opt-playwright both pull esbuild; it must appear once.
		const { deps } = collectBuildScriptDeps([unit('core-vitest'), unit('opt-playwright')], map);
		expect(deps).toEqual(['@playwright/test', 'esbuild']);
	});

	it('attributes to the first offender in selection order', () => {
		// The file is genuinely cross-unit; first-wins gives the state a real,
		// deterministic owner to hang attribution on.
		expect(collectBuildScriptDeps([unit('core-tailwind'), unit('core-vitest')], map).owner).toBe('core-tailwind');
	});
});

describe('the shipped BUILD_SCRIPT_DEPS policy', () => {
	it('allowlists esbuild for core-vitest, the confirmed pnpm 11 hard-fail', () => {
		// Vitest -> vite -> esbuild. On pnpm 11 an un-allowlisted esbuild build
		// exits `pnpm install` with ERR_PNPM_IGNORED_BUILDS, so this entry is the
		// whole reason the seed exists. The v11 e2e pins the rest of the map.
		expect(BUILD_SCRIPT_DEPS['core-vitest']).toContain('esbuild');
	});
});

describe('buildPnpmWorkspace', () => {
	it('emits both keys so one file works across pnpm majors', () => {
		const yaml = buildPnpmWorkspace(['esbuild']);
		// pnpm 10 reads the list...
		expect(yaml).toMatch(/onlyBuiltDependencies:\n\s+- esbuild/);
		// ...pnpm 11 reads the map.
		expect(yaml).toMatch(/allowBuilds:\n\s+esbuild: true/);
	});

	it('quotes scoped package names so the YAML stays valid', () => {
		const yaml = buildPnpmWorkspace(['@playwright/test']);
		// A bare `@playwright/test` is a YAML reserved-indicator error in both spots.
		expect(yaml).toContain('- \'@playwright/test\'');
		expect(yaml).toContain('\'@playwright/test\': true');
	});

	it('is settings-only by default, with no packages key (the pnpm 11 form)', () => {
		expect(buildPnpmWorkspace(['esbuild'])).not.toMatch(/^packages:/m);
	});

	it('declares a single-package stub when asked (pnpm 10 rejects a file without one)', () => {
		const yaml = buildPnpmWorkspace(['esbuild'], { withPackages: true });
		expect(yaml).toMatch(/^packages:$/m);
		// Plain scalar, not `- '.'`: a scaffold's own ESLint yaml formatter rejects
		// the needless quotes, which broke every preset install on pnpm 10 (#67).
		expect(yaml).toContain('- .');
		expect(yaml).not.toContain('- \'.\'');
	});
});

describe('seedPnpmWorkspace', () => {
	let tmp: string;
	const dest = (): string => join(tmp, 'pnpm-workspace.yaml');

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-pnpm-seed-'));
	});

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	it('writes the settings-only form on pnpm 11 and reports the tracked write', () => {
		const write = seedPnpmWorkspace({ targetDir: tmp, pm: 'pnpm', pmVersion: '11.5.2', units: [unit('core-vitest')] });
		expect(write).toEqual({ path: dest(), unit: 'core-vitest' });
		const yaml = readFileSync(dest(), 'utf-8');
		expect(yaml).toContain('esbuild: true');
		expect(yaml).not.toMatch(/^packages:/m);
	});

	it('writes the packages-stub form on pnpm 10, which rejects a stub-less file', () => {
		const write = seedPnpmWorkspace({ targetDir: tmp, pm: 'pnpm', pmVersion: '10.0.0', units: [unit('core-vitest')] });
		expect(write).toEqual({ path: dest(), unit: 'core-vitest' });
		expect(readFileSync(dest(), 'utf-8')).toMatch(/^packages:/m);
	});

	it('falls back to the widely-compatible form when the pnpm version is unknown', () => {
		// A failed version query must not produce a file that errors on old pnpm.
		seedPnpmWorkspace({ targetDir: tmp, pm: 'pnpm', pmVersion: null, units: [unit('core-vitest')] });
		expect(readFileSync(dest(), 'utf-8')).toMatch(/^packages:/m);
	});

	it('does nothing for a package manager other than pnpm', () => {
		expect(seedPnpmWorkspace({ targetDir: tmp, pm: 'npm', pmVersion: '10.0.0', units: [unit('core-vitest')] })).toBeNull();
		expect(existsSync(dest())).toBe(false);
	});

	it('does nothing when the run skips install (pm null)', () => {
		// pm null means "don't install", so seeding a pnpm-specific file would presume
		// a package manager the user never chose.
		expect(seedPnpmWorkspace({ targetDir: tmp, pm: null, pmVersion: null, units: [unit('core-vitest')] })).toBeNull();
		expect(existsSync(dest())).toBe(false);
	});

	it('does nothing when no selected unit builds', () => {
		expect(seedPnpmWorkspace({ targetDir: tmp, pm: 'pnpm', pmVersion: '11.5.2', units: [unit('core-eslint')] })).toBeNull();
		expect(existsSync(dest())).toBe(false);
	});

	it('defers to opt-monorepo, which ships its own workspace file', () => {
		const write = seedPnpmWorkspace({ targetDir: tmp, pm: 'pnpm', pmVersion: '11.5.2', units: [unit('core-vitest'), unit('opt-monorepo')] });
		expect(write).toBeNull();
		expect(existsSync(dest())).toBe(false);
	});

	it('never clobbers a pnpm-workspace.yaml the user already has', () => {
		writeFileSync(dest(), 'packages:\n  - packages/*\n');
		const write = seedPnpmWorkspace({ targetDir: tmp, pm: 'pnpm', pmVersion: '11.5.2', units: [unit('core-vitest')] });
		expect(write).toBeNull();
		expect(readFileSync(dest(), 'utf-8')).toBe('packages:\n  - packages/*\n');
	});
});
