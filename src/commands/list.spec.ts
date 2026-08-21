import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UNITS } from '../manifest/index';
import { buildCatalog, CATALOG_SCHEMA, formatCatalog, runList } from './list';

describe('buildCatalog', () => {
	it('wraps the units in a versioned envelope', () => {
		const catalog = buildCatalog();
		expect(catalog.schema).toBe(2);
		expect(CATALOG_SCHEMA).toBe(2);
		expect(catalog.units.length).toBe(UNITS.length);
	});

	it('omits internal file src paths but keeps the destination', () => {
		const catalog = buildCatalog();
		const editorconfig = catalog.units.find(u => u.id === 'core-editorconfig');
		expect(editorconfig?.files).toEqual([
			{ dest: '.editorconfig' },
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

	it('surfaces unit options (flavors) without leaking their internal files/deps', () => {
		const catalog = buildCatalog();
		const eslint = catalog.units.find(u => u.id === 'core-eslint');
		const flavor = eslint?.options?.find(o => o.key === 'eslintFlavor');
		expect(flavor?.default).toBe('base');
		expect(flavor?.choices.map(c => c.value)).toEqual(['base', 'react', 'next']);
		expect(flavor?.choices.every(c => typeof c.label === 'string')).toBe(true);
		// The choice's baked-in config content and devDeps are an internal detail —
		// the catalog surfaces the choice, not its payload.
		for (const choice of flavor?.choices ?? []) {
			expect(choice).not.toHaveProperty('files');
			expect(choice).not.toHaveProperty('devDependencies');
		}
	});

	it('is byte-for-byte stable across calls', () => {
		expect(JSON.stringify(buildCatalog())).toBe(JSON.stringify(buildCatalog()));
	});

	it('omits source entirely when no sources map is given — doctor\'s buildCatalog() call keeps its old shape', () => {
		const catalog = buildCatalog();
		for (const unit of catalog.units)
			expect(unit).not.toHaveProperty('source');
	});

	it('stamps each unit with its source when a sources map is threaded in', () => {
		const sources = new Map([
			['core-editorconfig', { kind: 'builtin' as const }],
			['my-units/banner', { kind: 'dir' as const, path: '/abs/my-units' }],
		]);
		const units = [...UNITS, { id: 'my-units/banner', category: 'foundation' as const, label: 'Banner', description: 'A local unit.', files: [] }];
		const catalog = buildCatalog(units, sources);
		expect(catalog.units.find(u => u.id === 'core-editorconfig')?.source).toEqual({ kind: 'builtin' });
		expect(catalog.units.find(u => u.id === 'my-units/banner')?.source).toEqual({ kind: 'dir', path: '/abs/my-units' });
		// A unit the map has no entry for (shouldn't happen in practice, but the lookup
		// is a plain Map#get) stays source-less rather than crashing.
		expect(catalog.units.find(u => u.id === 'core-eslint')).not.toHaveProperty('source');
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

	it('lists a unit\'s option flavors and marks the default', () => {
		const out = formatCatalog();
		expect(out).toMatch(/eslintFlavor: base \| react \| next/);
		expect(out).toMatch(/default: base/);
	});

	it('tags a local unit with its namespace, read straight off the id prefix, and leaves built-ins bare', () => {
		const units = [...UNITS, { id: 'my-units/banner', category: 'foundation' as const, label: 'Banner', description: 'A local unit.', files: [] }];
		const out = formatCatalog(units);
		const lines = out.split('\n');
		expect(lines.find(l => l.includes('my-units/banner'))).toMatch(/Banner — A local unit\.\s+\[local: my-units\]$/);
		// A built-in's line is untouched — no bracket marker anywhere on it.
		expect(lines.find(l => l.includes('core-editorconfig'))).not.toContain('[local:');
	});

	it('keeps built-ins-only output byte-for-byte unchanged by the local-unit marker code path', () => {
		expect(formatCatalog()).not.toContain('[local:');
	});
});

describe('catalog presets', () => {
	it('bumps the envelope to schema 2 and lists each preset with its resolved expansion', () => {
		const catalog = buildCatalog();
		expect(catalog.schema).toBe(2);
		const names = catalog.presets.map(p => p.name);
		expect(names).toEqual(['cli', 'next-app', 'node-lib']);

		// The expansion is the RESOLVED closure, so implied units show up:
		// next-app names opt-shadcn, and tailwind rides its implies edge.
		const nextApp = catalog.presets.find(p => p.name === 'next-app');
		expect(nextApp?.units).toContain('opt-shadcn');
		expect(nextApp?.units).toContain('core-tailwind');
		expect(nextApp?.description.length).toBeGreaterThan(0);
	});

	it('prints a presets section in the human catalog', () => {
		const out = formatCatalog();
		expect(out).toContain('Presets');
		expect(out).toContain('node-lib');
		expect(out).toContain('next-app');
	});
});

// A unit whose every field is valid, mirroring load-units.spec.ts's writeUnit — each
// fixture below only overrides the field it's exercising.
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

describe('runList', () => {
	let root: string;
	let stdout: string[];
	let stderr: string[];

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), 'unbranded-list-'));
		stdout = [];
		stderr = [];
		vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
			stdout.push(String(chunk));
			return true;
		});
		vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
			stderr.push(String(chunk));
			return true;
		});
	});

	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
		vi.restoreAllMocks();
	});

	it('names an invalid definition on stderr, never on stdout, so a --json consumer stays unaffected', () => {
		const dir = join(root, 'my-units');
		mkdirSync(dir);
		writeUnit(dir, 'good');
		mkdirSync(join(dir, 'broken'));
		writeFileSync(join(dir, 'broken', 'unit.json'), '{ not valid json');

		runList({ json: true, unitsDir: dir });

		expect(stderr.join('')).toContain('skipped');
		expect(stderr.join('')).toContain('broken');
		// stdout is pure JSON — a stray stderr line concatenated in would break a
		// --json consumer's parse, which is the whole reason the two are split.
		expect(() => JSON.parse(stdout.join(''))).not.toThrow();
		const catalog = JSON.parse(stdout.join('')) as { units: { id: string }[] };
		expect(catalog.units.some(u => u.id === 'my-units/good')).toBe(true);
	});

	it('names a warning (shadowing a built-in id) on stderr for the human output too', () => {
		const dir = join(root, 'my-units');
		mkdirSync(dir);
		writeUnit(dir, 'shadow', { id: 'core-eslint' });

		runList({ unitsDir: dir });

		expect(stderr.join('')).toContain('shares its id with the built-in unit');
		expect(stdout.join('')).not.toContain('shares its id');
	});

	it('tags a --units-dir unit as local in both list and list --json', () => {
		const dir = join(root, 'my-units');
		mkdirSync(dir);
		writeUnit(dir, 'banner');

		runList({ unitsDir: dir });
		expect(stdout.join('')).toContain('[local: my-units]');

		stdout = [];
		runList({ json: true, unitsDir: dir });
		const catalog = JSON.parse(stdout.join('')) as { units: { id: string; source?: { kind: string; path?: string } }[] };
		const banner = catalog.units.find(u => u.id === 'my-units/banner');
		expect(banner?.source).toEqual({ kind: 'dir', path: dir });
		const editorconfig = catalog.units.find(u => u.id === 'core-editorconfig');
		expect(editorconfig?.source).toEqual({ kind: 'builtin' });
	});
});
