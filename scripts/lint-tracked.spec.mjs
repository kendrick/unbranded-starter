import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { lintTracked, trackedFiles } from './lint-tracked.mjs';

// Unformatted per oxfmt: bullet spacing and a run of blank lines.
const UNFORMATTED = '*   a\n\n\n\nb\n';

let dir;
const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'lint-tracked-'));
	git('init', '-q');
	git('config', 'user.name', 'Test');
	git('config', 'user.email', 'test@example.com');
	git('config', 'commit.gpgsign', 'false');
	// `{}` stops oxfmt from searching upward for a config outside the temp dir.
	writeFileSync(join(dir, '.oxfmtrc.json'), '{}\n');
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

const commitAll = () => {
	git('add', '-A');
	git('commit', '-q', '-m', 'init');
};

describe('trackedFiles', () => {
	it('lists committed files and leaves out untracked ones', () => {
		writeFileSync(join(dir, 'a.md'), 'a\n');
		git('add', 'a.md');
		git('commit', '-q', '-m', 'init');
		writeFileSync(join(dir, 'notes.md'), UNFORMATTED);
		expect(trackedFiles(dir)).toEqual(['a.md']);
	});

	it('leaves out a committed file that was then deleted from disk', () => {
		writeFileSync(join(dir, 'a.md'), 'a\n');
		writeFileSync(join(dir, 'gone.md'), 'gone\n');
		commitAll();
		unlinkSync(join(dir, 'gone.md'));
		expect(trackedFiles(dir).sort()).toEqual(['.oxfmtrc.json', 'a.md']);
	});
});

describe('lintTracked', () => {
	it('passes with an untracked unformatted file', () => {
		writeFileSync(join(dir, 'a.md'), 'a\n');
		commitAll();
		writeFileSync(join(dir, 'notes.md'), UNFORMATTED);
		expect(lintTracked(dir)).toBe(0);
	});

	it('fails once the unformatted file is committed', () => {
		writeFileSync(join(dir, 'a.md'), 'a\n');
		writeFileSync(join(dir, 'notes.md'), UNFORMATTED);
		commitAll();
		expect(lintTracked(dir)).not.toBe(0);
	});

	it('passes when every tracked file is unsupported', () => {
		writeFileSync(join(dir, 'LICENSE'), 'MIT\n');
		git('add', 'LICENSE');
		git('commit', '-q', '-m', 'init');
		expect(lintTracked(dir)).toBe(0);
	});
});
