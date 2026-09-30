import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PKG_ROOT } from '../../src/util/paths';

// #158: which lint unit resolves decides the TypeScript line, and opt-ci-github
// takes whichever lint unit is present. Read off the dry-run envelope, which is
// what a consumer sees before anything is written.
const CLI = join(PKG_ROOT, 'dist/cli.js');

function dryRun(units: string, cwd: string, extra: string[] = []): { status: number | null; plan: { units: string[]; devDependencies?: Record<string, string> }; stderr: string } {
	const res = spawnSync('node', [CLI, '--dry-run', '--json', '--units', units, '--pm', 'pnpm', ...extra], { cwd, encoding: 'utf-8' });
	return { status: res.status, plan: res.status === 0 ? JSON.parse(res.stdout) : { units: [] }, stderr: res.stderr };
}

function scaffoldUnit(dir: string, unit: string): void {
	writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'ts-line', version: '0.0.0' }, null, 2));
	writeFileSync(join(dir, 'recipe.json'), JSON.stringify({ units: [unit], pm: null, onConflict: 'overwrite', postInstall: 'none' }));
	const scaffold = spawnSync('node', [CLI, '--config', 'recipe.json'], { cwd: dir, encoding: 'utf-8' });
	expect(scaffold.status, scaffold.stderr).toBe(0);
}

describe('typeScript line and lint slot (#158)', () => {
	let tmp: string;
	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-e2e-ts-line-'));
		// Without a package.json the CLI is in new-project mode and prompts for a name.
		writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'ts-line', version: '0.0.0' }, null, 2));
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

	it('under --latest, core-eslint reports typescript `latest`, as the real run writes', () => {
		const r = dryRun('core-eslint', tmp, ['--latest']);
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

	it('adding core-eslint to a project already on core-typescript\'s 7.x line rewrites typescript to 6.x', () => {
		// core-eslint implies core-typescript, so the tracked unit rejoins the plan and
		// its line-selected pin overwrites the 7.x one (PR #168 review).
		const dir = mkdtempSync(join(tmp, 'ts-then-eslint-'));
		scaffoldUnit(dir, 'core-typescript');
		const pkgPath = join(dir, 'package.json');
		expect(JSON.parse(readFileSync(pkgPath, 'utf-8')).devDependencies.typescript).toMatch(/^\^?7\./);

		const planned = dryRun('core-eslint', dir);
		expect(planned.status, planned.stderr).toBe(0);
		expect(planned.plan.devDependencies?.typescript).toMatch(/^\^?6\./);

		writeFileSync(join(dir, 'recipe.json'), JSON.stringify({ units: ['core-eslint'], pm: null, onConflict: 'overwrite', postInstall: 'none' }));
		const added = spawnSync('node', [CLI, '--config', 'recipe.json'], { cwd: dir, encoding: 'utf-8' });
		expect(added.status, added.stderr).toBe(0);
		expect(JSON.parse(readFileSync(pkgPath, 'utf-8')).devDependencies.typescript).toMatch(/^\^?6\./);
	});

	it('update keeps a core-eslint project on the 6.x line, and moves a core-oxlint one to 7.x', () => {
		for (const [unit, line] of [['core-eslint', /^\^?6\./], ['core-oxlint', /^\^?7\./]] as const) {
			const dir = mkdtempSync(join(tmp, `${unit}-`));
			scaffoldUnit(dir, unit);

			// An older scaffold: the pin #141 moved off.
			const pkgPath = join(dir, 'package.json');
			const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
			pkg.devDependencies.typescript = '5.9.3';
			writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));

			const update = spawnSync('node', [CLI, 'update', '--yes', '--strategy', 'theirs'], { cwd: dir, encoding: 'utf-8' });
			expect(update.status, `${update.stdout}${update.stderr}`).toBe(0);
			expect(JSON.parse(readFileSync(pkgPath, 'utf-8')).devDependencies.typescript, unit).toMatch(line);
		}
	});
});
