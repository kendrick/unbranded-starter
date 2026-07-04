import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { gitCapture, isDirty, isDirtyGitTree } from './git';

describe('isDirty (porcelain predicate)', () => {
	it('treats empty and whitespace-only output as clean', () => {
		expect(isDirty('')).toBe(false);
		expect(isDirty('\n')).toBe(false);
		expect(isDirty('   \n  ')).toBe(false);
	});

	it('treats any porcelain entry as dirty', () => {
		expect(isDirty('?? new.txt\n')).toBe(true);
		expect(isDirty(' M src/index.ts\n')).toBe(true);
	});
});

describe('gitCapture / isDirtyGitTree (real git)', () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), 'unbranded-gitcap-'));
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	function initRepo(cwd: string): void {
		execFileSync('git', ['init'], { cwd });
		execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd });
		execFileSync('git', ['config', 'user.name', 'Test'], { cwd });
	}

	it('captures stdout from a status --porcelain run', async () => {
		initRepo(dir);
		writeFileSync(join(dir, 'untracked.txt'), 'hi\n');
		const out = await gitCapture(dir, ['status', '--porcelain']);
		expect(out).not.toBeNull();
		expect(out).toMatch(/untracked\.txt/);
	});

	it('resolves null when git cannot run (not a repo)', async () => {
		// No `git init` here: `status` exits non-zero outside a work tree, which the
		// capturing helper reports as null the same way runGit reports false.
		const out = await gitCapture(dir, ['status', '--porcelain']);
		expect(out).toBeNull();
	});

	it('reports a non-git directory as not dirty', async () => {
		expect(await isDirtyGitTree(dir)).toBe(false);
	});

	it('reports a clean committed tree as not dirty', async () => {
		initRepo(dir);
		writeFileSync(join(dir, 'seed.txt'), 'seed\n');
		execFileSync('git', ['add', '-A'], { cwd: dir });
		execFileSync('git', ['commit', '-m', 'seed'], { cwd: dir });
		expect(await isDirtyGitTree(dir)).toBe(false);
	});

	it('reports uncommitted changes as dirty', async () => {
		initRepo(dir);
		writeFileSync(join(dir, 'seed.txt'), 'seed\n');
		execFileSync('git', ['add', '-A'], { cwd: dir });
		execFileSync('git', ['commit', '-m', 'seed'], { cwd: dir });
		writeFileSync(join(dir, 'seed.txt'), 'changed\n');
		expect(await isDirtyGitTree(dir)).toBe(true);
	});

	it('counts a lone untracked file as dirty', async () => {
		initRepo(dir);
		writeFileSync(join(dir, 'stray.txt'), 'stray\n');
		expect(await isDirtyGitTree(dir)).toBe(true);
	});
});
