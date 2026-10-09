import { describe, expect, it } from 'vitest';
import { groupByUnit, planBumps, rewritePackageJson, rewritePins } from './bump-pins.mjs';

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

describe('planBumps with held lines', () => {
	it('maps a held 6.0.3 pin to 6.0.5, never across its line', () => {
		const report = {
			schema: 1,
			packages: [
				{ name: 'typescript', pin: '6.0.3', line: 6, latest: '6.0.5', behind: 'patch', units: ['core-typescript'] },
				{ name: 'typescript', pin: '6.0.3', line: 6, latest: '7.0.3', behind: 'major', units: ['core-typescript'] },
			],
		};
		expect(planBumps(report)).toEqual([{ name: 'typescript', from: '6.0.3', to: '6.0.5', units: ['core-typescript'] }]);
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

describe('rewritePackageJson', () => {
	const PKG = `{
	"name": "unbranded",
	"dependencies": {
		"kleur": "^4.1.5"
	},
	"devDependencies": {
		"@antfu/eslint-config": "^8.2.0",
		"ajv": "8.20.0"
	}
}
`;

	it('preserves a caret range and an exact pin, byte-for-byte outside the version', () => {
		const expected = `{
	"name": "unbranded",
	"dependencies": {
		"kleur": "^4.1.5"
	},
	"devDependencies": {
		"@antfu/eslint-config": "^9.3.0",
		"ajv": "8.21.0"
	}
}
`;
		const { source, applied } = rewritePackageJson(PKG, [
			{ name: '@antfu/eslint-config', to: '9.3.0' },
			{ name: 'ajv', to: '8.21.0' },
		]);
		expect(source).toBe(expected);
		expect(applied.sort()).toEqual(['@antfu/eslint-config', 'ajv']);
	});

	it('rewrites a dependencies entry, not just devDependencies', () => {
		const expected = PKG.replace('"kleur": "^4.1.5"', '"kleur": "^5.0.0"');
		const { source, applied } = rewritePackageJson(PKG, [
			{ name: 'kleur', to: '5.0.0' },
		]);
		expect(source).toBe(expected);
		expect(applied).toEqual(['kleur']);
	});

	it('leaves a name in neither map as a miss and the source untouched', () => {
		const { source, applied, missed } = rewritePackageJson(PKG, [
			{ name: 'turbo', to: '3.0.0' },
		]);
		expect(source).toBe(PKG);
		expect(applied).toEqual([]);
		expect(missed).toEqual(['turbo']);
	});

	it('applies what it finds and misses what it does not, in one call', () => {
		const { applied, missed } = rewritePackageJson(PKG, [
			{ name: 'ajv', to: '8.21.0' },
			{ name: 'husky', to: '9.0.0' },
		]);
		expect(applied).toEqual(['ajv']);
		expect(missed).toEqual(['husky']);
	});

	it('counts a package already at the target version as applied, not missed', () => {
		// A refreshed branch re-running the same bump must be idempotent: the
		// pin is present and matches, so it's a no-op splice, not a failure to find it.
		const { source, applied, missed } = rewritePackageJson(PKG, [
			{ name: 'ajv', to: '8.20.0' },
		]);
		expect(source).toBe(PKG);
		expect(applied).toEqual(['ajv']);
		expect(missed).toEqual([]);
	});
});

describe('rewritePackageJson across majors', () => {
	const PKG_TS6 = `{
	"devDependencies": {
		"typescript": "^6.0.3"
	}
}
`;
	const PKG = `{
	"devDependencies": {
		"@antfu/eslint-config": "^8.2.0"
	}
}
`;

	it('leaves a range on another major alone: an unheld 7.x bump misses ^6', () => {
		const r = rewritePackageJson(PKG_TS6, [{ name: 'typescript', from: '7.0.2', to: '7.0.3' }]);
		expect(r.source).toBe(PKG_TS6);
		expect(r.missed).toEqual(['typescript']);
	});

	it('moves the range on its own major, even when an unheld bump of the same name rides along', () => {
		const r = rewritePackageJson(PKG_TS6, [
			{ name: 'typescript', from: '7.0.2', to: '7.0.3' },
			{ name: 'typescript', from: '6.0.3', to: '6.0.5' },
		]);
		expect(JSON.parse(r.source).devDependencies.typescript).toBe('^6.0.5');
	});

	it('still moves a major bump whose from sits on the range', () => {
		const r = rewritePackageJson(PKG, [{ name: '@antfu/eslint-config', from: '8.2.0', to: '9.3.0' }]);
		expect(JSON.parse(r.source).devDependencies['@antfu/eslint-config']).toBe('^9.3.0');
	});

	it('advances a range already on the target major: manifest 8.x to 9.3.0 moves ^9.2.0', () => {
		const ahead = PKG.replace('^8.2.0', '^9.2.0');
		const r = rewritePackageJson(ahead, [{ name: '@antfu/eslint-config', from: '8.2.0', to: '9.3.0' }]);
		expect(JSON.parse(r.source).devDependencies['@antfu/eslint-config']).toBe('^9.3.0');
		expect(r.applied).toEqual(['@antfu/eslint-config']);
	});
});

describe('rewritePins with two typescript pins', () => {
	it('rewrites only the literal matching from', () => {
		const src = 'const a = { typescript: \'7.0.2\' };\nconst b = { typescript: \'6.0.3\' };\n';
		const r = rewritePins(src, [{ name: 'typescript', from: '6.0.3', to: '6.0.5' }]);
		expect(r.source).toBe('const a = { typescript: \'7.0.2\' };\nconst b = { typescript: \'6.0.5\' };\n');
		expect(r.applied).toEqual(['typescript']);
	});
});
