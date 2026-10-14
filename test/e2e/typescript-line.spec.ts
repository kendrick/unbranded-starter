import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { STATE_FILENAME } from '../../src/state/state';
import { PKG_ROOT } from '../../src/util/paths';

// #158/#193: core-typescript's typescriptLine option picks the TypeScript line,
// core-eslint holds it to 6, and opt-ci-github takes whichever lint unit is
// present. Read off the dry-run envelope, which is what a consumer sees before
// anything is written.
const CLI = join(PKG_ROOT, 'dist/cli.js');

function dryRun(
	units: string,
	cwd: string,
	extra: string[] = [],
): {
	status: number | null;
	plan: { units: string[]; devDependencies?: Record<string, string> };
	stderr: string;
} {
	const res = spawnSync(
		'node',
		[CLI, '--dry-run', '--json', '--units', units, '--pm', 'pnpm', ...extra],
		{ cwd, encoding: 'utf-8' },
	);
	return {
		status: res.status,
		plan: res.status === 0 ? JSON.parse(res.stdout) : { units: [] },
		stderr: res.stderr,
	};
}

function scaffoldUnit(dir: string, unit: string): void {
	writeFileSync(
		join(dir, 'package.json'),
		JSON.stringify({ name: 'ts-line', version: '0.0.0' }, null, 2),
	);
	writeFileSync(
		join(dir, 'recipe.json'),
		JSON.stringify({ units: [unit], pm: null, onConflict: 'overwrite', postInstall: 'none' }),
	);
	const scaffold = spawnSync('node', [CLI, '--config', 'recipe.json'], {
		cwd: dir,
		encoding: 'utf-8',
	});
	expect(scaffold.status, scaffold.stderr).toBe(0);
}

describe('typeScript line (#158, #193)', () => {
	let tmp: string;
	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-e2e-ts-line-'));
		// Without a package.json the CLI is in new-project mode and prompts for a name.
		writeFileSync(
			join(tmp, 'package.json'),
			JSON.stringify({ name: 'ts-line', version: '0.0.0' }, null, 2),
		);
	});
	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	it('core-typescript alone plans typescript 7.x', () => {
		const r = dryRun('core-typescript', tmp);
		expect(r.status, r.stderr).toBe(0);
		expect(r.plan.devDependencies?.typescript).toMatch(/^\^?7\./);
	});

	it('core-eslint plans the implied core-typescript on 6.x', () => {
		const r = dryRun('core-eslint', tmp);
		expect(r.status, r.stderr).toBe(0);
		expect(r.plan.units).toContain('core-typescript');
		expect(r.plan.devDependencies?.typescript).toMatch(/^\^?6\./);
	});

	it('under --latest, core-eslint holds typescript to `^6` and everything else goes to `latest` (#159)', () => {
		// dryRun passes --pm pnpm, matching #159's acceptance invocation.
		const r = dryRun('core-eslint', tmp, ['--latest']);
		expect(r.status, r.stderr).toBe(0);
		expect(r.plan.devDependencies?.typescript).toBe('^6');
		expect(r.plan.devDependencies?.eslint).toBe('latest');
	});

	it('under --latest, core-typescript alone still reports typescript `latest`', () => {
		const r = dryRun('core-typescript', tmp, ['--latest']);
		expect(r.status, r.stderr).toBe(0);
		expect(r.plan.devDependencies?.typescript).toBe('latest');
	});

	it('core-oxlint plans typescript 7.x', () => {
		const r = dryRun('core-oxlint', tmp);
		expect(r.status, r.stderr).toBe(0);
		expect(r.plan.devDependencies?.typescript).toMatch(/^\^?7\./);
	});

	it('opt-ci-github alone plans core-oxlint and not core-eslint', () => {
		const r = dryRun('opt-ci-github', tmp);
		expect(r.status, r.stderr).toBe(0);
		expect(r.plan.units).toContain('core-oxlint');
		expect(r.plan.units).not.toContain('core-eslint');
	});

	it('core-eslint with opt-ci-github exits 0, keeps core-eslint, and plans no core-oxlint', () => {
		const r = dryRun('core-eslint,opt-ci-github', tmp);
		expect(r.status, r.stderr).toBe(0);
		expect(r.plan.units).toContain('core-eslint');
		expect(r.plan.units).not.toContain('core-oxlint');
	});

	it('in a project already tracking core-eslint, adding core-typescript plans 6.x and adding opt-ci-github plans no core-oxlint', () => {
		const dir = mkdtempSync(join(tmp, 'tracked-eslint-'));
		scaffoldUnit(dir, 'core-eslint');

		const ts = dryRun('core-typescript', dir);
		expect(ts.status, ts.stderr).toBe(0);
		expect(ts.plan.devDependencies?.typescript).toMatch(/^\^?6\./);

		const ci = dryRun('opt-ci-github', dir);
		expect(ci.status, ci.stderr).toBe(0);
		expect(ci.plan.units).not.toContain('core-oxlint');
	});

	it("adding core-eslint to a project already on core-typescript's 7.x line rewrites typescript to 6.x", () => {
		// core-eslint implies core-typescript, so the tracked unit rejoins the plan and
		// its line-selected pin overwrites the 7.x one (PR #168 review).
		const dir = mkdtempSync(join(tmp, 'ts-then-eslint-'));
		scaffoldUnit(dir, 'core-typescript');
		const pkgPath = join(dir, 'package.json');
		expect(JSON.parse(readFileSync(pkgPath, 'utf-8')).devDependencies.typescript).toMatch(
			/^\^?7\./,
		);

		const planned = dryRun('core-eslint', dir);
		expect(planned.status, planned.stderr).toBe(0);
		expect(planned.plan.devDependencies?.typescript).toMatch(/^\^?6\./);

		writeFileSync(
			join(dir, 'recipe.json'),
			JSON.stringify({
				units: ['core-eslint'],
				pm: null,
				onConflict: 'overwrite',
				postInstall: 'none',
			}),
		);
		const added = spawnSync('node', [CLI, '--config', 'recipe.json'], {
			cwd: dir,
			encoding: 'utf-8',
		});
		expect(added.status, added.stderr).toBe(0);
		expect(JSON.parse(readFileSync(pkgPath, 'utf-8')).devDependencies.typescript).toMatch(
			/^\^?6\./,
		);
	});

	it('update keeps a core-eslint project on the 6.x line, and moves a core-oxlint one to 7.x', () => {
		for (const [unit, line] of [
			['core-eslint', /^\^?6\./],
			['core-oxlint', /^\^?7\./],
		] as const) {
			const dir = mkdtempSync(join(tmp, `${unit}-`));
			scaffoldUnit(dir, unit);

			// An older scaffold: the pin #141 moved off.
			const pkgPath = join(dir, 'package.json');
			const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
			pkg.devDependencies.typescript = '5.9.3';
			writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));

			const update = spawnSync('node', [CLI, 'update', '--yes', '--strategy', 'theirs'], {
				cwd: dir,
				encoding: 'utf-8',
			});
			expect(update.status, `${update.stdout}${update.stderr}`).toBe(0);
			expect(JSON.parse(readFileSync(pkgPath, 'utf-8')).devDependencies.typescript, unit).toMatch(
				line,
			);
		}
	});

	it('core-typescript:6 with core-oxlint plans typescript 6.x and the oxc deps', () => {
		const r = dryRun('core-typescript:6,core-oxlint', tmp);
		expect(r.status, r.stderr).toBe(0);
		expect(r.plan.devDependencies?.typescript).toMatch(/^\^?6\./);
		expect(r.plan.devDependencies?.oxlint).toBeDefined();
	});

	it('core-typescript:6 with core-eslint plans typescript 6.x', () => {
		const r = dryRun('core-typescript:6,core-eslint', tmp);
		expect(r.status, r.stderr).toBe(0);
		expect(r.plan.devDependencies?.typescript).toMatch(/^\^?6\./);
	});

	it('core-typescript:7 with core-eslint exits 1, names typescript-eslint, and writes nothing', () => {
		const before = readdirSync(tmp).sort();
		const r = dryRun('core-typescript:7,core-eslint', tmp);
		expect(r.status).toBe(1);
		expect(r.stderr).toMatch(/typescript-eslint/);
		// The real run too, not just the dry run. A recipe's `units` takes no
		// `id:value` suffix, so the explicit line rides in `options`.
		writeFileSync(
			join(tmp, 'recipe.json'),
			JSON.stringify({
				units: ['core-typescript', 'core-eslint'],
				options: { typescriptLine: '7' },
				pm: null,
				onConflict: 'overwrite',
				postInstall: 'none',
			}),
		);
		const real = spawnSync('node', [CLI, '--config', 'recipe.json'], {
			cwd: tmp,
			encoding: 'utf-8',
		});
		expect(real.status, `${real.stdout}${real.stderr}`).toBe(1);
		expect(real.stderr).toMatch(/typescript-eslint/);
		expect(real.stdout).not.toMatch(/typescript-eslint/);
		expect(readdirSync(tmp).sort()).toEqual([...before, 'recipe.json'].sort());
	});

	it('under --latest, core-typescript:6 with core-oxlint holds typescript to ^6', () => {
		const r = dryRun('core-typescript:6,core-oxlint', tmp, ['--latest']);
		expect(r.status, r.stderr).toBe(0);
		expect(r.plan.devDependencies?.typescript).toBe('^6');
	});

	it('update infers the line from the declared typescript major, not from the lint unit', () => {
		for (const [declared, line] of [
			['^6.0.3', /^\^?6\./],
			['6.x', /^\^?6\./],
			['>=6.0.0 <7', /^\^?6\./],
			['^7.0.2', /^\^?7\./],
		] as const) {
			const dir = mkdtempSync(join(tmp, 'infer-'));
			scaffoldUnit(dir, 'core-oxlint');
			// A pre-#193 install: no recorded line.
			const statePath = join(dir, STATE_FILENAME);
			const state = JSON.parse(readFileSync(statePath, 'utf-8'));
			delete state.options?.typescriptLine;
			writeFileSync(statePath, JSON.stringify(state, null, 2));
			const pkgPath = join(dir, 'package.json');
			const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
			pkg.devDependencies.typescript = declared;
			writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));

			const update = spawnSync('node', [CLI, 'update', '--yes', '--strategy', 'theirs'], {
				cwd: dir,
				encoding: 'utf-8',
			});
			expect(update.status, `${update.stdout}${update.stderr}`).toBe(0);
			expect(
				JSON.parse(readFileSync(pkgPath, 'utf-8')).devDependencies.typescript,
				declared,
			).toMatch(line);
		}
	});

	it('update keeps a pre-#193 core-eslint install on 6.x', () => {
		const dir = mkdtempSync(join(tmp, 'legacy-eslint-'));
		scaffoldUnit(dir, 'core-eslint');
		const statePath = join(dir, STATE_FILENAME);
		const state = JSON.parse(readFileSync(statePath, 'utf-8'));
		delete state.options?.typescriptLine;
		writeFileSync(statePath, JSON.stringify(state, null, 2));
		const update = spawnSync('node', [CLI, 'update', '--yes', '--strategy', 'theirs'], {
			cwd: dir,
			encoding: 'utf-8',
		});
		expect(update.status, `${update.stdout}${update.stderr}`).toBe(0);
		expect(
			JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8')).devDependencies.typescript,
		).toMatch(/^\^?6\./);
	});

	it('re-selecting core-oxlint in a project on TS 6 keeps 6.x', () => {
		const dir = mkdtempSync(join(tmp, 'reselect-'));
		writeFileSync(
			join(dir, 'package.json'),
			JSON.stringify({ name: 'ts-line', version: '0.0.0' }, null, 2),
		);
		writeFileSync(
			join(dir, 'recipe.json'),
			JSON.stringify({
				units: ['core-typescript', 'core-oxlint'],
				options: { typescriptLine: '6' },
				pm: null,
				onConflict: 'overwrite',
				postInstall: 'none',
			}),
		);
		const scaffold = spawnSync('node', [CLI, '--config', 'recipe.json'], {
			cwd: dir,
			encoding: 'utf-8',
		});
		expect(scaffold.status, scaffold.stderr).toBe(0);
		const r = dryRun('core-oxlint:react', dir);
		expect(r.status, r.stderr).toBe(0);
		expect(r.plan.devDependencies?.typescript).toMatch(/^\^?6\./);
	});
});
