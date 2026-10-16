import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { lintTracked, trackedFiles } from './lint-tracked.mjs';

// Needs to trip `oxfmt --check` without tripping oxlint, so the failure is
// unambiguously the formatter's.
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

// The tests below that stage with `git('add', <file>)` instead of `commitAll`
// do it on purpose: it keeps the untracked `.oxfmtrc.json` out of the tracked
// set, and that is part of what they cover.
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

	it('names the committed unformatted file when the hook entry point fails', () => {
		writeFileSync(join(dir, 'a.md'), 'a\n');
		writeFileSync(join(dir, 'notes.md'), UNFORMATTED);
		commitAll();
		// The same invocation as the pre-push hook, so the output is what a
		// developer would see.
		const script = join(import.meta.dirname, 'lint-tracked.mjs');
		const { status, stdout, stderr } = spawnSync(process.execPath, [script], {
			cwd: dir,
			encoding: 'utf8',
		});
		expect(status).not.toBe(0);
		expect(stdout + stderr).toContain('notes.md');
	});

	it('fails on an oxlint error and never reaches oxfmt', () => {
		// `debugger;` is only a warning under oxlint's defaults, so the temp repo
		// ships a config that makes it an error. Same real tools as the hook.
		writeFileSync(join(dir, '.oxlintrc.json'), '{"rules":{"no-debugger":"error"}}\n');
		writeFileSync(join(dir, 'bad.js'), 'debugger;\n');
		writeFileSync(join(dir, 'notes.md'), UNFORMATTED);
		commitAll();
		expect(lintTracked(dir)).not.toBe(0);
		// notes.md is also unformatted, so oxfmt output would mean the
		// short-circuit broke and lint failures were being masked by the next step.
		const script = join(import.meta.dirname, 'lint-tracked.mjs');
		const { status, stdout, stderr } = spawnSync(process.execPath, [script], {
			cwd: dir,
			encoding: 'utf8',
		});
		expect(status).not.toBe(0);
		expect(stdout + stderr).toContain('no-debugger');
		expect(stdout + stderr).not.toContain('notes.md');
	});

	it('passes in a repo with no tracked files', () => {
		// Nothing is added, so `.oxfmtrc.json` stays untracked. The early
		// return keeps an empty list from reaching the tools, which could read an
		// empty argv as "lint everything".
		expect(trackedFiles(dir)).toEqual([]);
		expect(lintTracked(dir)).toBe(0);
	});

	it('passes when every tracked file is unsupported', () => {
		writeFileSync(join(dir, 'LICENSE'), 'MIT\n');
		git('add', 'LICENSE');
		git('commit', '-q', '-m', 'init');
		expect(lintTracked(dir)).toBe(0);
	});
});
