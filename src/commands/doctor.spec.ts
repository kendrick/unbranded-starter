import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { auditRepo } from './doctor';

function writeJson(path: string, obj: unknown): void {
	writeFileSync(path, JSON.stringify(obj, null, 2));
}

// A repo with every v1 signal satisfied, so the baseline audit is empty and each
// test below can knock out exactly one signal to prove that check in isolation.
function cleanRepo(dir: string): void {
	writeJson(join(dir, 'package.json'), {
		name: 'clean',
		packageManager: 'pnpm@10.0.0',
		engines: { node: '>=22' },
		scripts: { test: 'vitest run', lint: 'eslint .' },
		devDependencies: { typescript: '5.9.3' },
	});
	writeFileSync(join(dir, 'pnpm-lock.yaml'), '');
	writeFileSync(join(dir, '.editorconfig'), 'root = true\n');
	writeFileSync(join(dir, '.gitattributes'), '* text=auto\n');
	writeFileSync(join(dir, '.nvmrc'), '22\n');
	writeFileSync(join(dir, 'tsconfig.json'), '{}\n');
	mkdirSync(join(dir, '.github', 'workflows'), { recursive: true });
	writeFileSync(join(dir, '.github', 'workflows', 'ci.yml'), 'name: ci\n');
}

describe('auditRepo', () => {
	let tmp: string;
	const ids = (dir: string): string[] => auditRepo({ cwd: dir }).findings.map(f => f.id);

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-doctor-'));
	});

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	it('finds nothing in a repo that satisfies every v1 signal', () => {
		cleanRepo(tmp);
		expect(auditRepo({ cwd: tmp }).findings).toEqual([]);
	});

	it('every finding carries a non-empty fix so the report is actionable', () => {
		// A bare dir trips most checks at once; none may ship without a remedy.
		writeJson(join(tmp, 'package.json'), { name: 'bare' });
		for (const finding of auditRepo({ cwd: tmp }).findings)
			expect(finding.fix.length, finding.id).toBeGreaterThan(0);
	});

	it('names the core-editorconfig unit when .editorconfig is missing', () => {
		cleanRepo(tmp);
		rmSync(join(tmp, '.editorconfig'));
		const finding = auditRepo({ cwd: tmp }).findings.find(f => f.id === 'missing-editorconfig');
		expect(finding?.unit).toBe('core-editorconfig');
		expect(finding?.fix).toContain('core-editorconfig');
	});

	it('names the core-gitattributes unit when .gitattributes is missing', () => {
		cleanRepo(tmp);
		rmSync(join(tmp, '.gitattributes'));
		const finding = auditRepo({ cwd: tmp }).findings.find(f => f.id === 'missing-gitattributes');
		expect(finding?.unit).toBe('core-gitattributes');
		expect(finding?.fix).toContain('core-gitattributes');
	});

	it('names the core-node-version unit when no Node pin exists', () => {
		// core-node-version computes .nvmrc rather than shipping it, so the fix-it
		// unit can't be found by destination — doctor has to name it directly.
		cleanRepo(tmp);
		rmSync(join(tmp, '.nvmrc'));
		writeJson(join(tmp, 'package.json'), { name: 'clean', scripts: { test: 'vitest run', lint: 'eslint .' }, devDependencies: { typescript: '5.9.3' } });
		const finding = auditRepo({ cwd: tmp }).findings.find(f => f.id === 'no-node-version');
		expect(finding?.unit).toBe('core-node-version');
		expect(finding?.fix).toContain('core-node-version');
	});

	it('names the opt-ci-github unit when no CI workflow exists', () => {
		cleanRepo(tmp);
		rmSync(join(tmp, '.github'), { recursive: true });
		const finding = auditRepo({ cwd: tmp }).findings.find(f => f.id === 'no-ci-workflow');
		expect(finding?.unit).toBe('opt-ci-github');
		expect(finding?.fix).toContain('opt-ci-github');
	});

	it('reports coexisting lockfiles and which one detection would pick', () => {
		cleanRepo(tmp);
		writeFileSync(join(tmp, 'yarn.lock'), '');
		writeFileSync(join(tmp, 'package-lock.json'), '{}');
		const finding = auditRepo({ cwd: tmp }).findings.find(f => f.id === 'multiple-lockfiles');
		expect(finding).toBeDefined();
		// All three coexisting lockfiles named, plus the precedence winner (pnpm).
		expect(finding?.message).toContain('pnpm-lock.yaml');
		expect(finding?.message).toContain('yarn.lock');
		expect(finding?.message).toContain('package-lock.json');
		expect(finding?.fix).toContain('pnpm-lock.yaml');
	});

	it('flags TypeScript in deps with no tsconfig.json, pointing at core-typescript', () => {
		cleanRepo(tmp);
		rmSync(join(tmp, 'tsconfig.json'));
		const finding = auditRepo({ cwd: tmp }).findings.find(f => f.id === 'ts-dep-no-tsconfig');
		expect(finding?.unit).toBe('core-typescript');
	});

	it('flags a tsconfig.json with no TypeScript dependency, pointing at core-typescript', () => {
		writeJson(join(tmp, 'package.json'), { name: 'x', scripts: { test: 't', lint: 'l' }, engines: { node: '>=22' } });
		writeFileSync(join(tmp, 'tsconfig.json'), '{}\n');
		const finding = auditRepo({ cwd: tmp }).findings.find(f => f.id === 'tsconfig-no-ts-dep');
		expect(finding?.unit).toBe('core-typescript');
	});

	it('names core-vitest and core-eslint for missing test and lint scripts', () => {
		writeJson(join(tmp, 'package.json'), { name: 'x' });
		const found = auditRepo({ cwd: tmp }).findings;
		expect(found.find(f => f.id === 'no-test-script')?.unit).toBe('core-vitest');
		expect(found.find(f => f.id === 'no-lint-script')?.unit).toBe('core-eslint');
	});

	it('flags a packageManager field that disagrees with the lockfile', () => {
		cleanRepo(tmp);
		// pnpm-lock.yaml on disk, but the field claims yarn.
		writeJson(join(tmp, 'package.json'), {
			name: 'x',
			packageManager: 'yarn@4.0.0',
			engines: { node: '>=22' },
			scripts: { test: 't', lint: 'l' },
			devDependencies: { typescript: '5.9.3' },
		});
		expect(ids(tmp)).toContain('pm-field-lockfile-mismatch');
	});

	it('flags engines.node and .nvmrc when they disagree on the major', () => {
		cleanRepo(tmp);
		writeFileSync(join(tmp, '.nvmrc'), '18\n'); // engines says >=22
		expect(ids(tmp)).toContain('node-version-mismatch');
	});

	it('reports malformed package.json as a finding instead of throwing', () => {
		writeFileSync(join(tmp, 'package.json'), '{ "name": ');
		expect(() => auditRepo({ cwd: tmp })).not.toThrow();
		expect(ids(tmp)).toContain('malformed-package-json');
	});
});
