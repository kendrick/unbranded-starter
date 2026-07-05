import type { UnitId } from '../manifest/types';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { UNITS } from '../manifest/index';
import { resolveSelection } from '../manifest/resolve';
import { loadConfig, resolveConfig } from './load';
import { buildRecipe, serializeRecipe } from './recipe';

const KNOWN = new Set(UNITS.map(u => u.id));
const unitIds = (...values: string[]): UnitId[] => values as UnitId[];

// The closed-under-implies id set a real interactive run would hand buildRecipe.
function resolvedIds(seed: UnitId[]): UnitId[] {
	const result = resolveSelection(seed, UNITS);
	if (result.kind !== 'ok')
		throw new Error(`fixture selection did not resolve: ${result.kind}`);
	return result.ids;
}

describe('buildRecipe', () => {
	it('emits a Config-shaped object with a version marker', () => {
		const recipe = buildRecipe({ ids: resolvedIds(unitIds('core-editorconfig')), pm: 'pnpm', latest: false, version: '1.2.3' });
		expect(recipe._generatedBy).toBe('unbranded 1.2.3');
		expect(recipe.pm).toBe('pnpm');
		expect(Array.isArray(recipe.units)).toBe(true);
	});

	it('normalizes the un-capturable interactive decisions to a reproducible policy', () => {
		// Interactive runs resolve conflicts per file and prompt post-installs one
		// at a time, so there is no single value to record. The recipe documents the
		// replay policy instead: overwrite existing files, run every post-install.
		const recipe = buildRecipe({ ids: resolvedIds(unitIds('core-editorconfig')), pm: null, latest: false, version: '1.0.0' });
		expect(recipe.onConflict).toBe('overwrite');
		expect(recipe.postInstall).toBe('all');
		expect(recipe.git).toBe('none');
	});

	it('maps the latest flag onto the versions field', () => {
		expect(buildRecipe({ ids: unitIds('core-editorconfig'), pm: null, latest: true, version: '1.0.0' }).versions).toBe('latest');
		expect(buildRecipe({ ids: unitIds('core-editorconfig'), pm: null, latest: false, version: '1.0.0' }).versions).toBe('pinned');
	});

	it('includes projectName only when the run supplied one (new-project mode)', () => {
		expect(buildRecipe({ ids: unitIds('core-editorconfig'), pm: null, latest: false, version: '1.0.0' }).projectName).toBeUndefined();
		expect(buildRecipe({ ids: unitIds('core-editorconfig'), pm: null, latest: false, version: '1.0.0', projectName: 'acme' }).projectName).toBe('acme');
	});

	it('records the chosen unit options so a replay rebuilds the same flavor', () => {
		const recipe = buildRecipe({ ids: unitIds('core-eslint'), pm: null, latest: false, version: '1.0.0', options: { eslintFlavor: 'react' } });
		expect(recipe.options).toEqual({ eslintFlavor: 'react' });
	});

	it('omits options entirely when the run selected none', () => {
		expect(buildRecipe({ ids: unitIds('core-editorconfig'), pm: null, latest: false, version: '1.0.0' })).not.toHaveProperty('options');
		expect(buildRecipe({ ids: unitIds('core-editorconfig'), pm: null, latest: false, version: '1.0.0', options: {} })).not.toHaveProperty('options');
	});
});

describe('serializeRecipe', () => {
	it('pretty-prints with a trailing newline, matching the run.ts write convention', () => {
		const text = serializeRecipe(buildRecipe({ ids: unitIds('core-editorconfig'), pm: null, latest: false, version: '1.0.0' }));
		expect(text.endsWith('}\n')).toBe(true);
		expect(text).toContain('\n  "'); // two-space indented keys, matching run.ts
	});
});

describe('recipe round-trip (emitted recipe reproduces the resolved plan)', () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), 'unbranded-recipe-'));
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it('loads back to the identical closed-under-implies selection', () => {
		// core-eslint implies core-typescript, so the resolved set is bigger than
		// the seed. The recipe has to preserve the closed set, and reloading it must
		// resolve to exactly the same ids, or a replay would drift from the run.
		const ids = resolvedIds(unitIds('core-eslint'));
		expect(ids).toContain('core-typescript');

		const path = join(dir, 'recipe.json');
		writeFileSync(path, serializeRecipe(buildRecipe({ ids, pm: null, latest: false, version: '1.0.0' })));

		const loaded = resolveConfig(loadConfig(path, KNOWN), {}, KNOWN);
		expect(loaded.units).toEqual(ids);
		expect(resolvedIds(loaded.units)).toEqual(ids);
	});
});
