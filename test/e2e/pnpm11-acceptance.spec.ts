import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PKG_ROOT } from '../../src/util/paths';

// #67: on pnpm 11 an un-allowlisted native build (esbuild, via Vitest) fails
// `pnpm install` outright, so the seeded pnpm-workspace.yaml has to actually
// clear that install on the major that hard-fails. CI is pinned to pnpm 10 and
// can't see this, so pnpm 11 is driven through `npx pnpm@11` here: the repo
// still builds under its own pinned pnpm 10, and only the scaffolded project
// under test is installed on 11. Heavy (two real installs plus an npx fetch) and
// network-bound, so it's gated to its own CI job and explicit local runs.
const CLI = join(PKG_ROOT, 'dist/cli.js');

function pnpm11(cwd: string, args: string[]): { status: number | null; output: string } {
	const res = spawnSync('npx', ['--yes', 'pnpm@11', ...args], { cwd, encoding: 'utf-8', env: { ...process.env, CI: 'true' } });
	return { status: res.status, output: `${res.stdout}\n${res.stderr}` };
}

function writeStub(dir: string): void {
	mkdirSync(join(dir, 'src'), { recursive: true });
	writeFileSync(join(dir, 'src', 'index.ts'), 'export const answer = 42;\n');
	writeFileSync(join(dir, 'src', 'index.spec.ts'), [
		'import { expect, it } from \'vitest\';',
		'import { answer } from \'./index\';',
		'it(\'runs user code\', () => expect(answer).toBe(42));',
		'',
	].join('\n'));
}

describe.skipIf(!process.env.UB_PNPM11)('pnpm 11 acceptance: the seeded allowlist clears a real install', () => {
	let tmp: string;

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-e2e-pnpm11-'));
	});

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	it('a Vitest scaffold installs and tests clean on pnpm 11', () => {
		// core-vitest alone isolates the build-script path (esbuild) without pulling
		// the rest of a preset; core-node-version is left out on purpose so no
		// packageManager pin fights the npx pnpm@11 that drives the real install.
		writeFileSync(join(tmp, 'recipe.json'), JSON.stringify({ units: ['core-vitest'], pm: 'pnpm', onConflict: 'overwrite', postInstall: 'none' }));
		writeFileSync(join(tmp, 'package.json'), `${JSON.stringify({ name: 'p', version: '0.0.0', private: true, type: 'module' }, null, '\t')}\n`);

		const scaffold = spawnSync('node', [CLI, '--config', 'recipe.json'], { cwd: tmp, encoding: 'utf-8' });
		expect(scaffold.status, `scaffold: ${scaffold.stderr}\n${scaffold.stdout}`).toBe(0);
		// The seed is what makes the next step possible; assert it landed.
		expect(existsSync(join(tmp, 'pnpm-workspace.yaml'))).toBe(true);
		expect(readFileSync(join(tmp, 'pnpm-workspace.yaml'), 'utf-8')).toMatch(/allowBuilds:\n\s+esbuild: true/);

		writeStub(tmp);
		const install = pnpm11(tmp, ['install', '--no-frozen-lockfile']);
		expect(install.status, install.output).toBe(0);
		const test = pnpm11(tmp, ['test']);
		expect(test.status, test.output).toBe(0);
	}, 300_000);

	it('without the allowlist, the same install hard-fails on pnpm 11 (proves the seed does the work)', () => {
		// The negative half of the proof: with no seed, pnpm 11 refuses to run the
		// esbuild build and stops the install cold, exactly what #67 reported.
		writeFileSync(join(tmp, 'package.json'), `${JSON.stringify({ name: 'p', version: '0.0.0', private: true, type: 'module', devDependencies: { vitest: '2.1.9' } }, null, '\t')}\n`);

		const install = pnpm11(tmp, ['install', '--no-frozen-lockfile']);
		expect(install.status, install.output).not.toBe(0);
		expect(install.output).toMatch(/ignored build|ERR_PNPM_IGNORED_BUILDS/i);
	}, 300_000);
});
