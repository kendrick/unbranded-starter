import type { StateFile } from '../state/state';
import type { Finding } from './doctor';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applySuppression, auditRepo, KNOWN_FINDING_IDS, readDoctorIgnore } from './doctor';

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

	it('registers every finding id a live audit can emit, so doctor.ignore recognizes it', () => {
		// applySuppression tells a typo from a valid-but-quiet id by looking it up in
		// KNOWN_FINDING_IDS. If a new check ships without registering its id, that set
		// goes stale and every use of the id in doctor.ignore looks like a typo. Trip a
		// broad slice of the checks and assert each id we see is registered.
		const emitted = new Set<string>();
		const scenario = (name: string, build: (dir: string) => void): void => {
			const dir = join(tmp, name);
			mkdirSync(dir, { recursive: true });
			build(dir);
			for (const f of auditRepo({ cwd: dir }).findings)
				emitted.add(f.id);
		};

		scenario('bare', d => writeJson(join(d, 'package.json'), { name: 'bare' }));
		scenario('malformed', d => writeFileSync(join(d, 'package.json'), '{ "name": '));
		scenario('lockfiles', (d) => {
			cleanRepo(d);
			writeFileSync(join(d, 'yarn.lock'), '');
			writeFileSync(join(d, 'package-lock.json'), '{}');
		});
		scenario('pm-mismatch', (d) => {
			// pnpm lockfile on disk, but the field claims yarn.
			writeFileSync(join(d, 'pnpm-lock.yaml'), '');
			writeJson(join(d, 'package.json'), {
				name: 'x',
				packageManager: 'yarn@4.0.0',
				engines: { node: '>=22' },
				scripts: { test: 't', lint: 'l' },
				devDependencies: { typescript: '5.9.3' },
			});
		});
		scenario('node-mismatch', (d) => {
			cleanRepo(d);
			writeFileSync(join(d, '.nvmrc'), '18\n');
		});
		scenario('tsconfig-no-dep', (d) => {
			writeJson(join(d, 'package.json'), { name: 'x', scripts: { test: 't', lint: 'l' }, engines: { node: '>=22' } });
			writeFileSync(join(d, 'tsconfig.json'), '{}\n');
		});
		scenario('ts-dep-no-tsconfig', (d) => {
			cleanRepo(d);
			rmSync(join(d, 'tsconfig.json'));
		});

		for (const id of emitted)
			expect(KNOWN_FINDING_IDS.has(id), `unregistered finding id: ${id}`).toBe(true);
		// Guard against a no-op test: the scenarios above must exercise a real slice.
		expect(emitted.size).toBeGreaterThanOrEqual(9);
	});
});

describe('applySuppression', () => {
	const finding = (id: string): Finding => ({ id, message: id, fix: 'x' });

	it('moves ignored findings out of active and into suppressed', () => {
		const r = applySuppression([finding('missing-editorconfig'), finding('no-test-script')], ['missing-editorconfig']);
		expect(r.active.map(f => f.id)).toEqual(['no-test-script']);
		expect(r.suppressed.map(f => f.id)).toEqual(['missing-editorconfig']);
		expect(r.unknownIgnored).toEqual([]);
	});

	it('stays quiet about a valid id whose check simply did not fire this run', () => {
		// no-lint-script is a real finding id, just not among this run's findings.
		// Suppressing it pre-emptively is legitimate and must not warn.
		const r = applySuppression([finding('missing-editorconfig')], ['no-lint-script']);
		expect(r.suppressed).toEqual([]);
		expect(r.unknownIgnored).toEqual([]);
	});

	it('flags an unrecognized ignore id as unknown, and suppresses nothing with it', () => {
		const r = applySuppression([finding('missing-editorconfig')], ['missing-editorconfg']);
		expect(r.unknownIgnored).toEqual(['missing-editorconfg']);
		expect(r.active.map(f => f.id)).toEqual(['missing-editorconfig']);
	});

	it('dedupes repeated unknown ids', () => {
		expect(applySuppression([], ['nope', 'nope']).unknownIgnored).toEqual(['nope']);
	});
});

describe('readDoctorIgnore', () => {
	it('returns the ignore list from a state file', () => {
		expect(readDoctorIgnore({ doctor: { ignore: ['a', 'b'] } } as StateFile)).toEqual(['a', 'b']);
	});

	it('degrades to [] for a missing file or an absent doctor block', () => {
		expect(readDoctorIgnore(undefined)).toEqual([]);
		expect(readDoctorIgnore({} as StateFile)).toEqual([]);
	});

	it('drops non-string junk instead of crashing the audit', () => {
		expect(readDoctorIgnore({ doctor: { ignore: ['ok', 3, null] } } as unknown as StateFile)).toEqual(['ok']);
	});

	it('treats a non-array ignore value as empty', () => {
		expect(readDoctorIgnore({ doctor: { ignore: 'missing-editorconfig' } } as unknown as StateFile)).toEqual([]);
	});
});
