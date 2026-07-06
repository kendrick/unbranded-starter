import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PKG_ROOT } from '../../src/util/paths';

const CLI = join(PKG_ROOT, 'dist/cli.js');

// SGR color/style sequences start with ESC-[; a string check keeps eslint's
// no-control-regex out of it. This is the whole audit in one predicate: does a
// script-facing pipe carry any styling.
function hasAnsi(s: string): boolean {
	return s.includes('\x1B[');
}

function writeJson(path: string, obj: unknown): void {
	writeFileSync(path, JSON.stringify(obj, null, 2));
}

// spawnSync pipes stdio, so the child's stdout.isTTY is undefined (a real pipe).
// The env is normalized: ambient NO_COLOR/FORCE_COLOR are stripped so a color
// setting on the CI runner can't skew a case, then the test's overlay is applied.
function run(args: string[], tmp: string, env: Record<string, string> = {}): ReturnType<typeof spawnSync> {
	const base = { ...process.env };
	delete base.NO_COLOR;
	delete base.FORCE_COLOR;
	return spawnSync('node', [CLI, ...args], { cwd: tmp, encoding: 'utf-8', env: { ...base, ...env } });
}

// Scaffold a single plain-copy unit (no deps, no install) so a .unbranded.json
// lands, then edit the file so `diff` has real drift to render a patch for.
function scaffoldDrift(tmp: string): void {
	writeJson(join(tmp, 'package.json'), { name: 'drift-project', version: '0.0.0' });
	writeJson(join(tmp, 'recipe.json'), { units: ['core-editorconfig'], pm: null, onConflict: 'overwrite', postInstall: 'none' });
	const applied = run(['--config', 'recipe.json'], tmp);
	expect(applied.status, `scaffold stderr: ${applied.stderr}`).toBe(0);
	writeFileSync(join(tmp, '.editorconfig'), `${readFileSync(join(tmp, '.editorconfig'), 'utf-8')}\n# my override\n`);
}

describe('piped output carries no ANSI, even under CI', () => {
	let tmp: string;

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-e2e-nocolor-'));
	});

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	// CI=true is the case node's styleText ignores but a naive picocolors setup
	// would have colored; pinning it here proves a stray CI can't leak escapes.
	it('list', () => {
		const r = run(['list'], tmp, { CI: 'true' });
		expect(r.status).toBe(0);
		expect(hasAnsi(r.stdout)).toBe(false);
	});

	it('doctor', () => {
		const r = run(['doctor'], tmp, { CI: 'true' });
		expect(r.status).toBe(0);
		expect(hasAnsi(r.stdout)).toBe(false);
	});

	it('diff (untracked nudge)', () => {
		const r = run(['diff'], tmp, { CI: 'true' });
		expect(r.status).toBe(0);
		expect(hasAnsi(r.stdout)).toBe(false);
	});

	it('diff --diff on a drifted file', () => {
		scaffoldDrift(tmp);
		const r = run(['diff', '--diff'], tmp, { CI: 'true' });
		expect(r.status).toBe(1);
		// The patch rendered (so this isn't a vacuous pass) but carries no color.
		expect(r.stdout).toContain('my override');
		expect(hasAnsi(r.stdout)).toBe(false);
	});

	it('--dry-run --diff over a clack-driven flow', () => {
		writeJson(join(tmp, 'package.json'), { name: 'p', version: '0.0.0' });
		writeFileSync(join(tmp, 'eslint.config.mjs'), '// mine, do not touch\n');
		writeJson(join(tmp, 'recipe.json'), { units: ['core-eslint'], pm: null, onConflict: 'overwrite', postInstall: 'none' });
		const r = run(['--config', 'recipe.json', '--dry-run', '--diff'], tmp, { CI: 'true' });
		expect(r.status).toBe(0);
		// createPatch labels the proposed side, so this proves the diff block rendered.
		expect(r.stdout).toContain('proposed');
		expect(hasAnsi(r.stdout)).toBe(false);
	});
});

describe('explicit color control on a pipe', () => {
	let tmp: string;

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-e2e-color-'));
	});

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	it('keeps a piped diff colored under FORCE_COLOR', () => {
		scaffoldDrift(tmp);
		const r = run(['diff', '--diff'], tmp, { FORCE_COLOR: '1' });
		expect(r.status).toBe(1);
		// The drift adds a line the template lacks, so the patch removes it: a red -.
		expect(r.stdout).toContain('\x1B[31m');
	});

	it('--no-color wins over FORCE_COLOR', () => {
		scaffoldDrift(tmp);
		const r = run(['diff', '--diff', '--no-color'], tmp, { FORCE_COLOR: '1' });
		expect(r.status).toBe(1);
		expect(r.stdout).toContain('my override');
		expect(hasAnsi(r.stdout)).toBe(false);
	});

	it('--color forces color even when piped', () => {
		scaffoldDrift(tmp);
		const r = run(['diff', '--diff', '--color'], tmp);
		expect(r.status).toBe(1);
		expect(r.stdout).toContain('\x1B[31m');
	});
});
