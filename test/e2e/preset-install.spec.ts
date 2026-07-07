import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PKG_ROOT } from '../../src/util/paths';

// The acceptance test #38 asks for: each preset scaffolds a real project that
// passes its own lint, typecheck, and test scripts. Real pnpm installs make
// these the heaviest e2e in the suite, so CI fans them out one job per preset
// (UB_PRESET selects one; unset runs all three locally) and the fast e2e leg
// skips the file entirely via UB_E2E_LEG=main.
const CLI = join(PKG_ROOT, 'dist/cli.js');
const ONLY_PRESET = process.env.UB_PRESET;

function presetRuns(name: 'node-lib' | 'next-app' | 'cli'): boolean {
	return ONLY_PRESET === undefined || ONLY_PRESET === name;
}

// A fresh scaffold has no source, and both `tsc --noEmit` and `vitest run`
// fail on zero inputs by design. The stub is the smallest real project: one
// exported const and one spec that imports it, which also proves the scaffolded
// config actually resolves user code.
function writeStubProject(dir: string): void {
	mkdirSync(join(dir, 'src'), { recursive: true });
	writeFileSync(join(dir, 'src', 'index.ts'), 'export const answer = 42;\n');
	writeFileSync(join(dir, 'src', 'index.spec.ts'), [
		'import { describe, expect, it } from \'vitest\';',
		'import { answer } from \'./index\';',
		'',
		'describe(\'the scaffold\', () => {',
		'\tit(\'resolves and runs user code\', () => {',
		'\t\texpect(answer).toBe(42);',
		'\t});',
		'});',
		'',
	].join('\n'));
}

function runPreset(name: string, tmp: string): void {
	// Tab-indented on purpose: augment mode preserves the existing file's indent
	// (#48's accepted tension), and the scaffold's own lint enforces tabs — a
	// two-space seed here would fail the very lint this test exists to run.
	writeFileSync(join(tmp, 'package.json'), `${JSON.stringify({ name: `preset-${name}`, version: '0.0.0', private: true }, null, '\t')}\n`);
	// pnpm 11 hard-fails scripts when a dependency's build was ignored (esbuild,
	// via vitest): strictDepBuilds is on by default and the allowlist moved from
	// onlyBuiltDependencies (v10) to the allowBuilds map (v11). Both keys ride
	// here so the suite passes under either major — CI runs v10 per the repo's
	// packageManager pin, local corepack may resolve v11. Whether scaffolds
	// should seed this themselves is a product question the suite shouldn't
	// answer on its own (see the PR discussion).
	writeFileSync(join(tmp, 'pnpm-workspace.yaml'), 'onlyBuiltDependencies:\n  - esbuild\nallowBuilds:\n  esbuild: true\n');
	const scaffold = spawnSync('node', [CLI, '--preset', name, '--pm', 'pnpm', '--on-conflict', 'overwrite'], { cwd: tmp, encoding: 'utf-8' });
	expect(scaffold.status, `scaffold stderr: ${scaffold.stderr}\nstdout: ${scaffold.stdout}`).toBe(0);
	writeStubProject(tmp);
}

// The scaffold's own scripts, via its own package manager. CI=true forces
// antfu's full ruleset, same as the flavor and scaffold-lint suites.
function script(tmp: string, name: string): { status: number | null; output: string } {
	const res = spawnSync('pnpm', [name], { cwd: tmp, encoding: 'utf-8', env: { ...process.env, CI: 'true' } });
	return { status: res.status, output: `${res.stdout}\n${res.stderr}` };
}

describe.skipIf(process.env.UB_E2E_LEG === 'main')('shipped presets scaffold working projects (e2e, real install)', () => {
	let tmp: string;

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-e2e-preset-install-'));
	});

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	it.runIf(presetRuns('node-lib'))('node-lib passes its own lint, typecheck, and test', () => {
		runPreset('node-lib', tmp);
		for (const name of ['lint', 'typecheck', 'test']) {
			const result = script(tmp, name);
			expect(result.status, `${name}: ${result.output}`).toBe(0);
		}
	}, 300_000);

	it.runIf(presetRuns('next-app'))('next-app passes its own lint, typecheck, and test', () => {
		runPreset('next-app', tmp);
		// test:e2e (Playwright) is deliberately not run: browsers aren't installed
		// (postInstall none), and a fresh scaffold has no e2e specs anyway.
		for (const name of ['lint', 'typecheck', 'test']) {
			const result = script(tmp, name);
			expect(result.status, `${name}: ${result.output}`).toBe(0);
		}
	}, 300_000);

	it.runIf(presetRuns('cli'))('cli passes its own lint, typecheck, and test', () => {
		runPreset('cli', tmp);
		for (const name of ['lint', 'typecheck', 'test']) {
			const result = script(tmp, name);
			expect(result.status, `${name}: ${result.output}`).toBe(0);
		}
	}, 300_000);
});
