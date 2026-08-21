import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PKG_ROOT } from '../util/paths';
import { loadCatalog } from './catalog';
import { UNITS } from './index';
import { resolveSelection } from './resolve';

function writeUnit(dir: string, dirName: string, extra: Record<string, unknown> = {}): void {
	const unitDir = join(dir, dirName);
	mkdirSync(unitDir, { recursive: true });
	writeFileSync(join(unitDir, 'unit.json'), JSON.stringify({
		schema: 1,
		id: dirName,
		category: 'foundation',
		label: dirName,
		description: `Fixture unit ${dirName}.`,
		files: [],
		...extra,
	}));
}

describe('loadCatalog', () => {
	it('returns exactly the built-in catalog with no unitsDir', () => {
		const catalog = loadCatalog();
		expect(catalog.units.map(u => u.id)).toEqual(UNITS.map(u => u.id));
		expect(catalog.ids).toEqual(new Set(UNITS.map(u => u.id)));
		expect(catalog.builtinIds).toEqual(new Set(UNITS.map(u => u.id)));
		expect(catalog.skipped).toEqual([]);
		expect(catalog.warnings).toEqual([]);
		for (const unit of catalog.units) {
			expect(catalog.sources.get(unit.id)).toEqual({ kind: 'builtin' });
			expect(catalog.templateRoots.get(unit.id)).toBe(PKG_ROOT);
		}
	});

	it('builds optionSchema over the built-in catalog alone', () => {
		const catalog = loadCatalog();
		expect(catalog.optionSchema.byUnit.has('core-eslint')).toBe(true);
	});

	describe('with a units directory', () => {
		let root: string;
		let dir: string;

		beforeEach(() => {
			root = mkdtempSync(join(tmpdir(), 'unbranded-catalog-'));
			dir = join(root, 'my-units');
			mkdirSync(dir);
		});

		afterEach(() => {
			rmSync(root, { recursive: true, force: true });
		});

		it('places built-ins first, then locals', () => {
			writeUnit(dir, 'banner');
			const catalog = loadCatalog({ unitsDirs: [dir] });
			expect(catalog.units.slice(0, UNITS.length).map(u => u.id)).toEqual(UNITS.map(u => u.id));
			expect(catalog.units.at(-1)?.id).toBe('my-units/banner');
		});

		it('records a dir source with the absolute units-dir path for every local unit', () => {
			writeUnit(dir, 'banner');
			const catalog = loadCatalog({ unitsDirs: [dir] });
			expect(catalog.sources.get('my-units/banner')).toEqual({ kind: 'dir', path: resolve(dir) });
		});

		it('points a local unit\'s templateRoot at its own directory, not the units-dir root', () => {
			writeUnit(dir, 'banner');
			const catalog = loadCatalog({ unitsDirs: [dir] });
			expect(catalog.templateRoots.get('my-units/banner')).toBe(join(dir, 'banner'));
		});

		it('folds a local unit\'s options into the merged optionSchema', () => {
			writeUnit(dir, 'banner', {
				options: [{ key: 'bannerStyle', label: 'Style', default: 'plain', choices: [{ value: 'plain', label: 'Plain' }] }],
			});
			const catalog = loadCatalog({ unitsDirs: [dir] });
			expect(catalog.optionSchema.values.get('bannerStyle')).toEqual(new Set(['plain']));
		});

		it('surfaces a directory load\'s warnings and skips on the returned Catalog', () => {
			writeUnit(dir, 'core-eslint');
			const catalog = loadCatalog({ unitsDirs: [dir] });
			expect(catalog.warnings).toHaveLength(1);
			expect(catalog.units.some(u => u.id === 'my-units/core-eslint')).toBe(true);
		});

		it('resolves a local seed through the implied built-in and the implied sibling via resolveSelection, unmodified', () => {
			writeUnit(dir, 'banner');
			writeUnit(dir, 'strict-docs', { implies: ['banner', 'core-eslint'] });

			const catalog = loadCatalog({ unitsDirs: [dir] });
			const result = resolveSelection(['my-units/strict-docs'], catalog.units);

			expect(result).toMatchObject({ kind: 'ok' });
			if (result.kind !== 'ok')
				return;
			// core-eslint itself implies core-typescript (see index.ts) — this
			// closure spans a local unit and two built-ins with no special-casing
			// in resolve.ts, which is the whole point of rewriting at load time.
			expect(new Set(result.ids)).toEqual(new Set(['my-units/strict-docs', 'my-units/banner', 'core-eslint', 'core-typescript']));
			expect(new Set(result.auto)).toEqual(new Set(['my-units/banner', 'core-eslint', 'core-typescript']));
		});
	});
});
