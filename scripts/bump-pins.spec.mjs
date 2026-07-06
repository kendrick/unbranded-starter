import { describe, expect, it } from 'vitest';
import { groupByUnit, planBumps, rewritePins } from './bump-pins.mjs';

describe('planBumps', () => {
	it('keeps only pins the registry is ahead of, mapping pin→from and latest→to', () => {
		const report = {
			schema: 1,
			packages: [
				{ name: 'eslint', pin: '9.39.4', latest: '10.0.0', behind: 'major', units: ['core-eslint'] },
				{ name: 'vitest', pin: '2.1.9', latest: '2.2.0', behind: 'minor', units: ['core-vitest'] },
				{ name: 'typescript', pin: '5.9.3', latest: '5.9.3', behind: 'up-to-date', units: ['core-typescript'] },
				{ name: 'weird', pin: 'latest', latest: '1.0.0', behind: 'unknown', units: ['core-eslint'] },
			],
		};
		expect(planBumps(report)).toEqual([
			{ name: 'eslint', from: '9.39.4', to: '10.0.0', units: ['core-eslint'] },
			{ name: 'vitest', from: '2.1.9', to: '2.2.0', units: ['core-vitest'] },
		]);
	});
});

describe('groupByUnit', () => {
	it('groups by the first declaring unit so each bump lands in exactly one PR', () => {
		const groups = groupByUnit([
			{ name: 'a', from: '1.0.0', to: '2.0.0', units: ['core-eslint'] },
			{ name: 'b', from: '1.0.0', to: '1.1.0', units: ['core-eslint', 'core-vitest'] },
			{ name: 'c', from: '3.0.0', to: '3.0.1', units: ['core-vitest'] },
		]);
		expect([...groups.keys()].sort()).toEqual(['core-eslint', 'core-vitest']);
		expect(groups.get('core-eslint')?.map(b => b.name)).toEqual(['a', 'b']);
		expect(groups.get('core-vitest')?.map(b => b.name)).toEqual(['c']);
	});
});

describe('rewritePins', () => {
	const SOURCE = `
	devDependencies: {
		'typescript': '5.9.3',
		'@types/node': '22.19.19',
	},
	other: {
		eslint: '9.39.4',
		coincidence: '9.39.4',
	},
	repeated: {
		eslint: '9.39.4',
	},
`;

	it('rewrites quoted and unquoted keys, every occurrence, and nothing else', () => {
		const { source, applied, missed } = rewritePins(SOURCE, [
			{ name: 'eslint', from: '9.39.4', to: '10.0.0' },
			{ name: '@types/node', from: '22.19.19', to: '24.0.0' },
		]);
		// Both eslint occurrences move; the coincidental same-version pin does not.
		expect(source).toContain('eslint: \'10.0.0\'');
		expect(source).not.toContain('eslint: \'9.39.4\'');
		expect(source).toContain('coincidence: \'9.39.4\'');
		expect(source).toContain('\'@types/node\': \'24.0.0\'');
		expect(applied.sort()).toEqual(['@types/node', 'eslint']);
		expect(missed).toEqual([]);
	});

	it('reports a bump it cannot find instead of silently skipping it', () => {
		// The manifest moved since outdated ran (or the pin format changed):
		// automation must fail loudly, not open a PR that bumps nothing.
		const { source, applied, missed } = rewritePins(SOURCE, [
			{ name: 'ghost', from: '1.0.0', to: '2.0.0' },
		]);
		expect(source).toBe(SOURCE);
		expect(applied).toEqual([]);
		expect(missed).toEqual(['ghost']);
	});
});
