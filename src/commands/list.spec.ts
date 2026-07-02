import { describe, expect, it } from 'vitest';
import { UNITS } from '../manifest/index';
import { buildCatalog, CATALOG_SCHEMA, formatCatalog } from './list';

describe('buildCatalog', () => {
	it('wraps the units in a versioned envelope', () => {
		const catalog = buildCatalog();
		expect(catalog.schema).toBe(1);
		expect(CATALOG_SCHEMA).toBe(1);
		expect(catalog.units.length).toBe(UNITS.length);
	});

	it('omits internal file src paths but keeps the destination', () => {
		const catalog = buildCatalog();
		const editorconfig = catalog.units.find(u => u.id === 'core-editorconfig');
		expect(editorconfig?.files).toEqual([
			{ dest: '.editorconfig' },
			{ dest: '.nvmrc' },
		]);
		// src anchors a path under PKG_ROOT — meaningless to any consumer and a
		// leak of our internal layout. It must not appear on any file entry.
		for (const unit of catalog.units) {
			for (const file of unit.files) {
				expect(file).not.toHaveProperty('src');
			}
		}
	});

	it('orders units by category display order, stable within a category', () => {
		const catalog = buildCatalog();
		const ids = catalog.units.map(u => u.id);
		expect(ids[0]).toBe('core-editorconfig');
		expect(ids.at(-1)).toBe('opt-monorepo');
		// The three style units keep their declared order under one category.
		const styleIds = catalog.units.filter(u => u.category === 'style').map(u => u.id);
		expect(styleIds).toEqual(['core-stylelint', 'core-tailwind', 'core-postcss']);
	});

	it('preserves the implies relationship for tooling', () => {
		const catalog = buildCatalog();
		const eslint = catalog.units.find(u => u.id === 'core-eslint');
		expect(eslint?.implies).toEqual(['core-typescript']);
	});

	it('is byte-for-byte stable across calls', () => {
		expect(JSON.stringify(buildCatalog())).toBe(JSON.stringify(buildCatalog()));
	});
});

describe('formatCatalog', () => {
	it('groups by category header and annotates implies', () => {
		const out = formatCatalog();
		expect(out).toContain('Foundation');
		expect(out).toContain('Linting');
		expect(out).toContain('core-eslint');
		expect(out).toMatch(/implies → core-typescript/);
	});
});
