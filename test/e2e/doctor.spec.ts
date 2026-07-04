import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PKG_ROOT } from '../../src/util/paths';

const CLI = join(PKG_ROOT, 'dist/cli.js');

function writeJson(path: string, obj: unknown): void {
	writeFileSync(path, JSON.stringify(obj, null, 2));
}

// Every file under `dir`, path plus contents, in a stable order. Snapshotting
// before and after is the hard proof that `doctor` wrote nothing.
function snapshot(dir: string): string {
	return (readdirSync(dir, { recursive: true }) as string[])
		.map(rel => join(dir, rel))
		.filter(p => statSync(p).isFile())
		.sort()
		.map(p => `${relative(dir, p)}\n${readFileSync(p, 'utf-8')}`)
		.join('\n---\n');
}

describe('unbranded doctor', () => {
	let tmp: string;

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-e2e-doctor-'));
	});

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	it('is read-only: audits a repo and writes absolutely nothing', () => {
		writeJson(join(tmp, 'package.json'), { name: 'audit-me' });
		writeFileSync(join(tmp, 'yarn.lock'), '');

		const before = snapshot(tmp);
		const result = spawnSync('node', [CLI, 'doctor'], { cwd: tmp, encoding: 'utf-8' });
		const after = snapshot(tmp);

		expect(result.status, `stderr: ${result.stderr}`).toBe(0);
		expect(after).toBe(before);
		// No state file, no install artifacts — doctor never scaffolds.
		expect(existsSync(join(tmp, '.unbranded.json'))).toBe(false);
		expect(existsSync(join(tmp, 'node_modules'))).toBe(false);
	});

	it('names the fix-it unit for each gap it finds', () => {
		writeJson(join(tmp, 'package.json'), { name: 'audit-me' });

		const result = spawnSync('node', [CLI, 'doctor'], { cwd: tmp, encoding: 'utf-8' });
		expect(result.status).toBe(0); // default exit is 0 even with findings
		// A missing .editorconfig points at the unit that ships it.
		expect(result.stdout).toContain('.editorconfig');
		expect(result.stdout).toContain('unbranded --units core-editorconfig');
	});

	it('reports coexisting lockfiles and which one detection would pick', () => {
		writeJson(join(tmp, 'package.json'), { name: 'audit-me' });
		writeFileSync(join(tmp, 'pnpm-lock.yaml'), '');
		writeFileSync(join(tmp, 'package-lock.json'), '{}');

		const result = spawnSync('node', [CLI, 'doctor'], { cwd: tmp, encoding: 'utf-8' });
		expect(result.stdout).toContain('pnpm-lock.yaml');
		expect(result.stdout).toContain('package-lock.json');
		expect(result.stdout).toMatch(/pick pnpm-lock\.yaml/);
	});

	it('--strict exits non-zero on findings; default exit stays 0', () => {
		writeJson(join(tmp, 'package.json'), { name: 'audit-me' });

		const strict = spawnSync('node', [CLI, 'doctor', '--strict'], { cwd: tmp, encoding: 'utf-8' });
		const lenient = spawnSync('node', [CLI, 'doctor'], { cwd: tmp, encoding: 'utf-8' });
		expect(strict.status).toBe(1);
		expect(lenient.status).toBe(0);
	});

	it('--json emits a machine-readable report with an ok flag', () => {
		writeJson(join(tmp, 'package.json'), { name: 'audit-me' });

		const result = spawnSync('node', [CLI, 'doctor', '--json'], { cwd: tmp, encoding: 'utf-8' });
		const parsed = JSON.parse(result.stdout) as { ok: boolean; findings: { id: string; fix: string }[] };
		expect(parsed.ok).toBe(false);
		expect(parsed.findings.length).toBeGreaterThan(0);
		expect(parsed.findings.every(f => f.fix.length > 0)).toBe(true);
	});

	it('a repo satisfying every signal reports clean and exits 0 under --strict', () => {
		writeJson(join(tmp, 'package.json'), {
			name: 'clean',
			packageManager: 'pnpm@10.0.0',
			engines: { node: '>=22' },
			scripts: { test: 'vitest run', lint: 'eslint .' },
			devDependencies: { typescript: '5.9.3' },
		});
		writeFileSync(join(tmp, 'pnpm-lock.yaml'), '');
		writeFileSync(join(tmp, '.editorconfig'), 'root = true\n');
		writeFileSync(join(tmp, '.gitattributes'), '* text=auto\n');
		writeFileSync(join(tmp, '.nvmrc'), '22\n');
		writeFileSync(join(tmp, 'tsconfig.json'), '{}\n');
		mkdirSync(join(tmp, '.github', 'workflows'), { recursive: true });
		writeFileSync(join(tmp, '.github', 'workflows', 'ci.yml'), 'name: ci\n');

		const result = spawnSync('node', [CLI, 'doctor', '--strict'], { cwd: tmp, encoding: 'utf-8' });
		expect(result.status, `stdout: ${result.stdout}`).toBe(0);
		expect(result.stdout).toMatch(/no issues found/i);
	});

	it('mentions `unbranded doctor` and --strict in --help', () => {
		const result = spawnSync('node', [CLI, '--help'], { encoding: 'utf-8' });
		expect(result.status).toBe(0);
		expect(result.stdout).toContain('unbranded doctor');
		expect(result.stdout).toContain('--strict');
	});
});
