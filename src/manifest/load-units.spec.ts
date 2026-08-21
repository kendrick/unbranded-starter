import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { UNITS } from './index';
import { loadUnitsDir } from './load-units';

const BUILTIN_IDS = new Set(UNITS.map(u => u.id));

// A unit every field of which is valid, so each fixture only has to override
// the field it's exercising — mirrors validate-unit.spec.ts's validBase().
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

describe('loadUnitsDir', () => {
	let root: string;
	let dir: string;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), 'unbranded-load-'));
		dir = join(root, 'my-units');
		mkdirSync(dir);
	});

	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	it('rewrites a sibling reference to its qualified form and leaves a built-in reference bare', () => {
		writeUnit(dir, 'banner');
		writeUnit(dir, 'strict-docs', { implies: ['banner', 'core-eslint'] });

		const loaded = loadUnitsDir(dir, BUILTIN_IDS);
		expect(loaded.skipped).toEqual([]);
		const strictDocs = loaded.units.find(u => u.id === 'my-units/strict-docs');
		expect(strictDocs?.implies).toEqual(['my-units/banner', 'core-eslint']);
		expect(loaded.units.map(u => u.id).sort()).toEqual(['my-units/banner', 'my-units/strict-docs']);
	});

	it('skips a unit whose JSON fails to parse', () => {
		const unitDir = join(dir, 'broken');
		mkdirSync(unitDir, { recursive: true });
		writeFileSync(join(unitDir, 'unit.json'), '{ not valid json');
		writeUnit(dir, 'banner');

		const loaded = loadUnitsDir(dir, BUILTIN_IDS);
		expect(loaded.units.map(u => u.id)).toEqual(['my-units/banner']);
		expect(loaded.skipped).toHaveLength(1);
		expect(loaded.skipped[0]?.issues[0]?.path).toBe('(document)');
	});

	it('skips a unit that fails validateUnitDefinition', () => {
		writeUnit(dir, 'bad-category', { category: 'not-a-real-category' });

		const loaded = loadUnitsDir(dir, BUILTIN_IDS);
		expect(loaded.units).toEqual([]);
		expect(loaded.skipped).toHaveLength(1);
		expect(loaded.skipped[0]?.id).toBe('bad-category');
		expect(loaded.skipped[0]?.issues.some(i => i.path === 'category')).toBe(true);
	});

	it('skips the later definition when a bare id is duplicated in the directory, naming the file that claimed it first', () => {
		// discover() sorts candidates by file path, so 'a-first' claims the id
		// before 'z-second' is even read.
		writeUnit(dir, 'a-first', { id: 'banner' });
		writeUnit(dir, 'z-second', { id: 'banner' });

		const loaded = loadUnitsDir(dir, BUILTIN_IDS);
		expect(loaded.units).toHaveLength(1);
		expect(loaded.skipped).toHaveLength(1);
		expect(loaded.skipped[0]?.issues[0]?.got).toContain('a-first');
	});

	it('skips a unit whose option key collides with a sibling\'s', () => {
		const flavorOption = (value: string) => [{ key: 'flavor', label: 'Flavor', default: value, choices: [{ value, label: value }] }];
		writeUnit(dir, 'first', { options: flavorOption('a') });
		writeUnit(dir, 'second', { options: flavorOption('b') });

		const loaded = loadUnitsDir(dir, BUILTIN_IDS);
		expect(loaded.units.map(u => u.id)).toEqual(['my-units/first']);
		expect(loaded.skipped).toHaveLength(1);
		expect(loaded.skipped[0]?.id).toBe('second');
	});

	it('skips a unit whose option key collides with a built-in\'s', () => {
		writeUnit(dir, 'clashing', {
			options: [{ key: 'eslintFlavor', label: 'Flavor', default: 'a', choices: [{ value: 'a', label: 'A' }] }],
		});

		const loaded = loadUnitsDir(dir, BUILTIN_IDS);
		expect(loaded.units).toEqual([]);
		expect(loaded.skipped).toHaveLength(1);
		expect(loaded.skipped[0]?.id).toBe('clashing');
	});

	it('warns when a local bare id shadows a built-in, but still loads it under the qualified id', () => {
		writeUnit(dir, 'core-eslint');

		const loaded = loadUnitsDir(dir, BUILTIN_IDS);
		expect(loaded.units.map(u => u.id)).toEqual(['my-units/core-eslint']);
		expect(loaded.skipped).toEqual([]);
		expect(loaded.warnings).toHaveLength(1);
		expect(loaded.warnings[0]).toContain('my-units/core-eslint');
	});

	it('does not warn for a bare id that names no built-in', () => {
		writeUnit(dir, 'banner');
		const loaded = loadUnitsDir(dir, BUILTIN_IDS);
		expect(loaded.warnings).toEqual([]);
	});

	it('throws assertValidNamespace\'s rule for a badly named directory', () => {
		const badDir = join(root, 'My Units');
		mkdirSync(badDir);
		writeUnit(badDir, 'banner');
		expect(() => loadUnitsDir(badDir, BUILTIN_IDS)).toThrow(/lowercase id/);
	});

	it('throws discover\'s error for a directory with no unit.json anywhere', () => {
		const emptyDir = join(root, 'empty-units');
		mkdirSync(emptyDir);
		expect(() => loadUnitsDir(emptyDir, BUILTIN_IDS)).toThrow(/no unit\.json/);
	});

	it('maps baseDirs to each surviving unit\'s own directory', () => {
		writeUnit(dir, 'banner');
		const loaded = loadUnitsDir(dir, BUILTIN_IDS);
		expect(loaded.baseDirs.get('my-units/banner')).toBe(join(dir, 'banner'));
	});
});
