import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	groupByUnit,
	MANIFEST_FILES,
	planBumps,
	rewritePackageJson,
	rewritePins,
	skipLoopUnits,
} from './bump-pins.mjs';
import { GROUPED_HEAD } from './pin-health-controller.mjs';

describe('planBumps', () => {
	it('keeps only pins the registry is ahead of, mapping pin→from and latest→to', () => {
		const report = {
			schema: 1,
			packages: [
				{
					name: 'eslint',
					pin: '9.39.4',
					latest: '10.0.0',
					behind: 'major',
					units: ['core-eslint'],
				},
				{ name: 'vitest', pin: '2.1.9', latest: '2.2.0', behind: 'minor', units: ['core-vitest'] },
				{
					name: 'typescript',
					pin: '5.9.3',
					latest: '5.9.3',
					behind: 'up-to-date',
					units: ['core-typescript'],
				},
				{
					name: 'weird',
					pin: 'latest',
					latest: '1.0.0',
					behind: 'unknown',
					units: ['core-eslint'],
				},
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
				{
					name: 'typescript',
					pin: '6.0.3',
					line: 6,
					latest: '6.0.5',
					behind: 'patch',
					units: ['core-typescript'],
				},
				{
					name: 'typescript',
					pin: '6.0.3',
					line: 6,
					latest: '7.0.3',
					behind: 'major',
					units: ['core-typescript'],
				},
			],
		};
		expect(planBumps(report)).toEqual([
			{ name: 'typescript', from: '6.0.3', to: '6.0.5', units: ['core-typescript'] },
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
		expect(groups.get('core-eslint')?.map((b) => b.name)).toEqual(['a', 'b']);
		expect(groups.get('core-vitest')?.map((b) => b.name)).toEqual(['c']);
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
		expect(source).toContain("eslint: '10.0.0'");
		expect(source).not.toContain("eslint: '9.39.4'");
		expect(source).toContain("coincidence: '9.39.4'");
		expect(source).toContain("'@types/node': '24.0.0'");
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
		const { source, applied } = rewritePackageJson(PKG, [{ name: 'kleur', to: '5.0.0' }]);
		expect(source).toBe(expected);
		expect(applied).toEqual(['kleur']);
	});

	it('leaves a name in neither map as a miss and the source untouched', () => {
		const { source, applied, missed } = rewritePackageJson(PKG, [{ name: 'turbo', to: '3.0.0' }]);
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
		const { source, applied, missed } = rewritePackageJson(PKG, [{ name: 'ajv', to: '8.20.0' }]);
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
		const r = rewritePackageJson(PKG, [
			{ name: '@antfu/eslint-config', from: '8.2.0', to: '9.3.0' },
		]);
		expect(JSON.parse(r.source).devDependencies['@antfu/eslint-config']).toBe('^9.3.0');
	});

	it('advances a range already on the target major: manifest 8.x to 9.3.0 moves ^9.2.0', () => {
		const ahead = PKG.replace('^8.2.0', '^9.2.0');
		const r = rewritePackageJson(ahead, [
			{ name: '@antfu/eslint-config', from: '8.2.0', to: '9.3.0' },
		]);
		expect(JSON.parse(r.source).devDependencies['@antfu/eslint-config']).toBe('^9.3.0');
		expect(r.applied).toEqual(['@antfu/eslint-config']);
	});
});

describe('rewritePins with two typescript pins', () => {
	it('rewrites only the literal matching from', () => {
		const src = "const a = { typescript: '7.0.2' };\nconst b = { typescript: '6.0.3' };\n";
		const r = rewritePins(src, [{ name: 'typescript', from: '6.0.3', to: '6.0.5' }]);
		expect(r.source).toBe(
			"const a = { typescript: '7.0.2' };\nconst b = { typescript: '6.0.5' };\n",
		);
		expect(r.applied).toEqual(['typescript']);
	});
});

describe('oxlint-config.ts pins', () => {
	it('rewrites a quoted oxlint-tsgolint key and reports it applied', () => {
		const source = `export const OXC_DEV_DEPENDENCIES = {\n\t'oxlint': '1.86.0',\n\t'oxlint-tsgolint': '7.0.2004',\n};\n`;
		const result = rewritePins(source, [
			{ name: 'oxlint-tsgolint', from: '7.0.2004', to: '7.0.2010' },
		]);
		expect(result.source).toContain("'oxlint-tsgolint': '7.0.2010'");
		expect(result.source).toContain("'oxlint': '1.86.0'");
		expect(result.applied).toEqual(['oxlint-tsgolint']);
		expect(result.missed).toEqual([]);
	});

	it('scans oxlint-config.ts, where the oxc pins live', () => {
		expect(MANIFEST_FILES).toContain('src/manifest/oxlint-config.ts');
	});
});

describe('skipLoopUnits', () => {
	it('sits out a unit whose pin-health repair PR is open, and only that unit', () => {
		const groups = new Map([
			['core-eslint', [{ name: 'eslint', from: '10.11.0', to: '10.12.0', units: ['core-eslint'] }]],
			['core-vitest', [{ name: 'vitest', from: '5.0.4', to: '5.0.5', units: ['core-vitest'] }]],
		]);
		const { kept, skipped } = skipLoopUnits(groups, [
			'pin-health/core-eslint',
			'bump/core-vitest',
			'pin-health/main-drift',
		]);
		expect(skipped).toEqual(['core-eslint']);
		expect([...kept.keys()]).toEqual(['core-vitest']);
	});

	it('keeps every unit when no repair PR is open', () => {
		const groups = new Map([['core-eslint', []]]);
		expect([...skipLoopUnits(groups, []).kept.keys()]).toEqual(['core-eslint']);
	});

	const twoUnits = () =>
		new Map([
			['core-eslint', [{ name: 'eslint', from: '10.11.0', to: '10.12.0', units: ['core-eslint'] }]],
			['core-oxlint', [{ name: 'oxlint', from: '1.86.0', to: '1.89.0', units: ['core-oxlint'] }]],
		]);

	it('grouped: an open bump/core-eslint drops core-eslint only', () => {
		const { kept, skipped } = skipLoopUnits(twoUnits(), ['bump/core-eslint'], { grouped: true });
		expect(skipped).toEqual(['core-eslint']);
		expect([...kept.keys()]).toEqual(['core-oxlint']);
	});

	it('grouped: open bump/weekly and pin-health/core-vitest drop neither unit', () => {
		const { kept, skipped } = skipLoopUnits(twoUnits(), ['bump/weekly', 'pin-health/core-vitest'], {
			grouped: true,
		});
		expect(skipped).toEqual([]);
		expect([...kept.keys()]).toEqual(['core-eslint', 'core-oxlint']);
	});

	it('per-unit: an open bump/core-eslint keeps both, since that is the PR it refreshes', () => {
		const { kept, skipped } = skipLoopUnits(twoUnits(), ['bump/core-eslint']);
		expect(skipped).toEqual([]);
		expect([...kept.keys()]).toEqual(['core-eslint', 'core-oxlint']);
	});
});

// The fake gh is a sh script and PATH joins on ':', and bump-pins.mjs runs only on the pin-bumps workflow's ubuntu runner. A local bare origin and the fake gh keep it off GitHub.
describe.skipIf(process.platform === 'win32')('bump-pins main()', () => {
	const SCRIPT = resolve(import.meta.dirname, 'bump-pins.mjs');
	const scratch = [];
	afterEach(() => {
		for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
	});

	// The #218 cases below predate the grouped default and pin per-unit behavior, so `run` defaults to `--per-unit`. Every gh call is logged, one line each, before it's answered, and `merge` answers the auto-merge call so `gh` itself only answers `pr create`.
	function fixture({ manifest, report, gh, merge = 'exit 0' }) {
		const root = mkdtempSync(join(tmpdir(), 'bump-pins-'));
		scratch.push(root);
		const env = {
			...process.env,
			GH_LOG: join(root, 'gh.log'),
			GIT_AUTHOR_NAME: 'a',
			GIT_AUTHOR_EMAIL: 'a@b',
			GIT_COMMITTER_NAME: 'a',
			GIT_COMMITTER_EMAIL: 'a@b',
			PATH: `${join(root, 'bin')}:${process.env.PATH}`,
		};
		const git = (...args) =>
			execFileSync('git', args, { cwd: join(root, 'work'), env, encoding: 'utf-8' });
		execFileSync('git', ['init', '-q', '--bare', join(root, 'origin.git')]);
		mkdirSync(join(root, 'work/src/manifest'), { recursive: true });
		mkdirSync(join(root, 'bin'));
		const put = (rel, text) => writeFileSync(join(root, rel), text);
		put('work/src/manifest/index.ts', manifest);
		put('work/src/manifest/eslint-config.ts', '// none\n');
		put('work/src/manifest/oxlint-config.ts', '// none\n');
		put('work/package.json', '{"name":"x","devDependencies":{}}\n');
		put('outdated.json', JSON.stringify({ packages: report }));
		put(
			'bin/gh',
			`#!/bin/sh\n{ printf '%s' "$*" | tr '\\n' ' '; echo; } >> "$GH_LOG"\n[ "$2" = list ] && { echo '[]'; exit 0; }\n[ "$2" = merge ] && { ${merge}; }\n${gh}`,
		);
		chmodSync(join(root, 'bin/gh'), 0o755);
		git('init', '-q', '-b', 'main');
		git('add', '-A');
		git('commit', '-qm', 'init');
		git('remote', 'add', 'origin', '../origin.git');
		const base = git('rev-parse', 'HEAD').trim();
		const run = (args = ['--per-unit']) =>
			spawnSync('node', [SCRIPT, join(root, 'outdated.json'), ...args], {
				cwd: join(root, 'work'),
				env,
				encoding: 'utf-8',
			});
		const ghLog = () => readFileSync(join(root, 'gh.log'), 'utf-8').trim().split('\n');
		return { git, base, run, ghLog };
	}

	const pkg = (name, pin, unit) => ({
		name,
		pin,
		latest: pin.replace(/\d+$/, (n) => String(Number(n) + 1)),
		behind: 'patch',
		units: [unit],
	});

	it('keeps a refused unit’s partial bump out of the next unit’s PR and the working tree', () => {
		const f = fixture({
			manifest: "export const X = {\n\tfoo: '1.0.0',\n\tbaz: '3.0.0',\n};\n",
			report: [
				pkg('foo', '1.0.0', 'unit-a'),
				pkg('bar', '2.0.0', 'unit-a'),
				pkg('baz', '3.0.0', 'unit-b'),
			],
			gh: 'exit 0\n',
		});
		const result = f.run();
		expect(result.status).toBe(1);
		expect(result.stderr).toContain('no pin literal found for bar');
		const changed = f.git('show', 'bump/unit-b', '--', 'src/manifest/index.ts');
		const edits = changed.split('\n').filter((l) => /^[+-]\t/.test(l));
		expect(edits).toEqual(["-\tbaz: '3.0.0',", "+\tbaz: '3.0.1',"]);
		expect(f.git('status', '--porcelain')).toBe('');
		expect(f.git('rev-parse', 'bump/unit-a').trim()).toBe(f.base);
	}, 60_000);

	it('fails on a gh error that is not "already exists"', () => {
		const f = fixture({
			manifest: "export const X = {\n\tbaz: '3.0.0',\n};\n",
			report: [pkg('baz', '3.0.0', 'unit-b')],
			gh: 'echo "HTTP 401: Bad credentials (https://api.github.com/graphql)" >&2\nexit 1\n',
		});
		const result = f.run();
		expect(result.status).not.toBe(0);
		expect(result.stderr).toContain('HTTP 401: Bad credentials');
		expect(result.stdout).not.toContain('already open');
	}, 60_000);

	it('still treats gh’s "already exists" as a refreshed PR', () => {
		const f = fixture({
			manifest: "export const X = {\n\tbaz: '3.0.0',\n};\n",
			report: [pkg('baz', '3.0.0', 'unit-b')],
			gh: `echo 'a pull request for branch "bump/unit-b" into branch "main" already exists:' >&2\nexit 1\n`,
		});
		const result = f.run();
		expect(result.status).toBe(0);
		expect(result.stdout).toContain('PR for bump/unit-b already open; branch refreshed.');
	}, 60_000);

	const indexEdits = (f, ref) =>
		f
			.git('show', ref, '--', 'src/manifest/index.ts')
			.split('\n')
			.filter((l) => /^[+-]\t/.test(l));

	it('grouped: two units ride one bump/weekly branch, one commit, one PR, one auto-merge call', () => {
		const f = fixture({
			manifest: "export const X = {\n\tfoo: '1.0.0',\n\tbaz: '3.0.0',\n};\n",
			report: [pkg('foo', '1.0.0', 'unit-a'), pkg('baz', '3.0.0', 'unit-b')],
			gh: 'exit 0\n',
		});
		const result = f.run([]);
		expect(result.status).toBe(0);
		expect(f.git('rev-list', '--count', `${f.base}..${GROUPED_HEAD}`).trim()).toBe('1');
		const remote = f.git('ls-remote', '--heads', '../origin.git');
		expect(remote).toContain('refs/heads/bump/weekly');
		expect(remote).not.toContain('bump/unit-');
		expect(f.git('branch', '--list', 'bump/unit-*')).toBe('');
		expect(indexEdits(f, GROUPED_HEAD)).toEqual([
			"-\tfoo: '1.0.0',",
			"-\tbaz: '3.0.0',",
			"+\tfoo: '1.0.1',",
			"+\tbaz: '3.0.1',",
		]);
		const calls = f.ghLog().filter((l) => !l.startsWith('pr list'));
		expect(calls).toHaveLength(2);
		expect(calls[0]).toMatch(/^pr create .*--head bump\/weekly /);
		expect(calls[0]).toContain('### unit-a');
		expect(calls[1]).toBe('pr merge bump/weekly --auto --squash');
	}, 60_000);

	it('grouped: a unit with a missed pin drops out, the rest still ship, and the job exits 1', () => {
		const f = fixture({
			manifest: "export const X = {\n\tfoo: '1.0.0',\n\tbaz: '3.0.0',\n};\n",
			report: [
				pkg('foo', '1.0.0', 'unit-a'),
				pkg('bar', '2.0.0', 'unit-a'),
				pkg('baz', '3.0.0', 'unit-b'),
			],
			gh: 'exit 0\n',
		});
		const result = f.run([]);
		expect(result.status).toBe(1);
		expect(result.stderr).toContain('bump/unit-a: no pin literal found for bar');
		expect(indexEdits(f, GROUPED_HEAD)).toEqual(["-\tbaz: '3.0.0',", "+\tbaz: '3.0.1',"]);
		expect(f.git('ls-remote', '--heads', '../origin.git')).toContain('refs/heads/bump/weekly');
		expect(f.git('status', '--porcelain')).toBe('');
	}, 60_000);

	it('grouped: a failed auto-merge call fails the job after the PR was created', () => {
		const f = fixture({
			manifest: "export const X = {\n\tbaz: '3.0.0',\n};\n",
			report: [pkg('baz', '3.0.0', 'unit-b')],
			gh: 'exit 0\n',
			merge: 'echo "auto-merge is not allowed for this repository" >&2; exit 1',
		});
		const result = f.run([]);
		expect(result.status).toBe(1);
		expect(result.stdout).toContain('Opened PR for bump/weekly (1 pin).');
		expect(result.stderr).toContain(
			'bump/weekly: enabling auto-merge failed: auto-merge is not allowed for this repository',
		);
		const calls = f.ghLog().filter((l) => !l.startsWith('pr list'));
		expect(calls[0]).toMatch(/^pr create /);
		expect(calls[1]).toBe('pr merge bump/weekly --auto --squash');
	}, 60_000);

	it('grouped: a gh pr create error that is not "already exists" fails the job and skips auto-merge', () => {
		const f = fixture({
			manifest: "export const X = {\n\tbaz: '3.0.0',\n};\n",
			report: [pkg('baz', '3.0.0', 'unit-b')],
			gh: 'echo "HTTP 401: Bad credentials (https://api.github.com/graphql)" >&2\nexit 1\n',
		});
		const result = f.run([]);
		expect(result.status).not.toBe(0);
		expect(result.stderr).toContain('bump/weekly: gh pr create failed: HTTP 401: Bad credentials');
		expect(result.stdout).not.toContain('already open');
		const calls = f.ghLog();
		expect(calls.some((l) => l.startsWith('pr create '))).toBe(true);
		expect(calls.filter((l) => l.startsWith('pr merge'))).toEqual([]);
	}, 60_000);

	it('grouped: an already-open bump/weekly is refreshed and still gets auto-merge', () => {
		const f = fixture({
			manifest: "export const X = {\n\tbaz: '3.0.0',\n};\n",
			report: [pkg('baz', '3.0.0', 'unit-b')],
			gh: `echo 'a pull request for branch "bump/weekly" into branch "main" already exists:' >&2\nexit 1\n`,
		});
		const result = f.run([]);
		expect(result.status).toBe(0);
		expect(result.stdout).toContain('PR for bump/weekly already open; branch refreshed.');
		expect(f.ghLog()).toContain('pr merge bump/weekly --auto --squash');
	}, 60_000);

	it('--per-unit: one branch per unit, each with its own auto-merge call', () => {
		const f = fixture({
			manifest: "export const X = {\n\tfoo: '1.0.0',\n\tbaz: '3.0.0',\n};\n",
			report: [pkg('foo', '1.0.0', 'unit-a'), pkg('baz', '3.0.0', 'unit-b')],
			gh: 'exit 0\n',
		});
		const result = f.run(['--per-unit']);
		expect(result.status).toBe(0);
		const remote = f.git('ls-remote', '--heads', '../origin.git');
		expect(remote).toContain('refs/heads/bump/unit-a');
		expect(remote).toContain('refs/heads/bump/unit-b');
		expect(remote).not.toContain('bump/weekly');
		const merges = f.ghLog().filter((l) => l.startsWith('pr merge'));
		expect(merges).toEqual([
			'pr merge bump/unit-a --auto --squash',
			'pr merge bump/unit-b --auto --squash',
		]);
	}, 60_000);
});
