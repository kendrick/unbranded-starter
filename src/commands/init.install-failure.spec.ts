// @vitest-environment node
// jsdom (the project default) runs test code in a separate VM context, and
// Vitest's node-builtin mocking hooks the main-realm module loader—under
// jsdom a mocked `spawn` silently falls through to the real binary instead of
// the stub below, so these install-failure tests would shell out to a real
// `npm install`. Same fix as install/run.spec.ts, for the same reason.
import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { confirm, isCancel, select } from '@clack/prompts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { unitPicker } from '../prompts/unit-picker/prompt';
import { STATE_FILENAME } from '../state/state';
import { runInit } from './init';

// The picker is the one TTY boundary in the interactive branches below.
// Everything else in this file runs for real: the copy loop, the journal, and
// writeAndInstall itself. That's the whole point of this suite, unlike
// init.spec.ts, which mocks ../install/run wholesale and so can never prove a
// rollback actually restores bytes on disk.
vi.mock('../prompts/unit-picker/prompt', () => ({ unitPicker: vi.fn() }));

// `select`/`confirm` are stubbed so the keep/cancel branches can be driven
// without a real terminal. `isCancel` is wrapped, not replaced, so it keeps
// checking the real cancel symbol by default—copied from
// install/run.spec.ts:9-17, needed because a mocked select can't naturally
// produce that symbol on its own.
vi.mock('@clack/prompts', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@clack/prompts')>();
	return { ...actual, select: vi.fn(), confirm: vi.fn(), isCancel: vi.fn(actual.isCancel) };
});

// Only `spawn` is stubbed. Leaving the rest of node:child_process (and every
// other module in this run) real is what lets this suite exercise the actual
// #114 acceptance criterion, a rolled-back target matching its pre-run state,
// against the genuine copy loop and journal instead of a mocked stand-in.
vi.mock('node:child_process', async (importOriginal) => {
	const actual = await importOriginal<typeof import('node:child_process')>();
	return { ...actual, spawn: vi.fn() };
});

// A minimal stand-in for the ChildProcess runInstall and queryPmVersion read,
// copied from install/run.spec.ts.
function fakeChildProcess(): ChildProcess {
	const child = new EventEmitter() as unknown as ChildProcess;
	Object.assign(child, { kill: vi.fn(), killed: false, stdout: new EventEmitter() });
	return child;
}

// Drives both spawn calls a real install makes: queryPmVersion's `pm --version`
// probe (always answered with a harmless exit 0, so it never blocks the path
// under test) and the actual `pm install` spawn, which resolves per `code`.
function mockInstallSpawn(code: number): void {
	vi.mocked(spawn).mockImplementation((_command, args) => {
		const child = fakeChildProcess();
		const isVersionQuery = Array.isArray(args) && args.includes('--version');
		queueMicrotask(() => child.emit('exit', isVersionQuery ? 0 : code));
		return child;
	});
}

// Every file under `dir`, path plus contents, in a stable order. Copied from
// test/e2e/dry-run.spec.ts:16-24—comparing this before and after a run is
// the hard proof that a rollback undid every byte the run wrote, not just the
// ones an assertion happened to think to check.
function snapshot(dir: string): string {
	return (readdirSync(dir, { recursive: true }) as string[])
		.map(rel => join(dir, rel))
		.filter(p => statSync(p).isFile())
		.sort()
		.map(p => `${relative(dir, p)}\n${readFileSync(p, 'utf-8')}`)
		.join('\n---\n');
}

describe('runInit real install failure (#114)', () => {
	let tmp: string;

	beforeEach(() => {
		vi.mocked(spawn).mockReset();
	});

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
		vi.mocked(unitPicker).mockReset();
		vi.mocked(select).mockReset();
		vi.mocked(confirm).mockReset();
		// mockClear only, not mockReset—isCancel keeps delegating to the real
		// implementation from the module factory unless a test overrides it.
		vi.mocked(isCancel).mockClear();
	});

	it('restores the target to its exact pre-run state on rollback', async () => {
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-install-failure-rollback-'));
		// A dependency pin opt-husky's manifest will collide with, plus a script
		// that's genuinely the user's own—both have to survive the round trip
		// through mergePackageJson and back for this test to mean anything.
		writeFileSync(join(tmp, 'package.json'), JSON.stringify({
			name: 'my-app',
			version: '1.2.3',
			scripts: { 'my-script': 'echo mine' },
			devDependencies: { husky: '8.0.0' },
		}, null, 2));
		// opt-husky writes this file; pre-seeding distinct content forces the
		// onConflict overwrite path, so rollback has real bytes to restore.
		writeFileSync(join(tmp, 'lint-staged.config.mjs'), '// mine, do not touch\n');
		// A file no unit ever writes—the negative case for the snapshot, proof
		// that rollback isn't just deleting the whole directory and rebuilding it.
		writeFileSync(join(tmp, 'README.md'), '# untouched\n');

		mockInstallSpawn(2);
		const before = snapshot(tmp);

		const result = await runInit({ targetDir: tmp, inline: { units: 'opt-husky', pm: 'npm', yes: true } });

		expect(result).toEqual({ ok: false });
		expect(snapshot(tmp)).toBe(before);
		// The state file is the one thing rollback deliberately never writes—
		// see the comment above recordState() in init.ts. Its absence is as much
		// a part of "pre-run state" as any file's bytes.
		expect(existsSync(join(tmp, STATE_FILENAME))).toBe(false);

		const pkg = JSON.parse(readFileSync(join(tmp, 'package.json'), 'utf-8')) as {
			devDependencies: Record<string, string>;
			scripts: Record<string, string>;
		};
		expect(pkg.devDependencies.husky).toBe('8.0.0');
		expect(pkg.scripts).toEqual({ 'my-script': 'echo mine' });
		// husky's own file and the directory the copy loop created for it must
		// both be gone—a leftover empty .husky/ would mean the journal pruned
		// files but not the directories it made room for.
		expect(existsSync(join(tmp, '.husky'))).toBe(false);
	});

	it('leaves a conflict the copy loop skipped untouched by rollback', async () => {
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-install-failure-skip-'));
		writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'x', version: '0.0.0' }));
		writeFileSync(join(tmp, '.editorconfig'), '# mine\n');

		mockInstallSpawn(2);

		const result = await runInit({ targetDir: tmp, inline: { units: 'core-editorconfig', pm: 'npm', onConflict: 'skip', yes: true } });

		expect(result).toEqual({ ok: false });
		// A skipped conflict is never journaled (copyFileOp returns before the
		// write that would record it)—this file surviving byte-for-byte proves
		// that exclusion holds, not just that rollback happened to restore the
		// same bytes it would have written anyway.
		expect(readFileSync(join(tmp, '.editorconfig'), 'utf-8')).toBe('# mine\n');
		expect(existsSync(join(tmp, STATE_FILENAME))).toBe(false);
	});

	it('keeps the scaffolded files and writes state when the interactive prompt answers "keep"', async () => {
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-install-failure-keep-'));
		writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'x', version: '0.0.0' }));
		vi.mocked(unitPicker).mockResolvedValue({ ids: ['core-editorconfig'], flavors: {} });
		mockInstallSpawn(2);

		// "Start from a preset?" then the install-failure prompt—inline.pm keeps
		// pm detection out of the prompt sequence without tripping nonInteractive,
		// which is what keeps config===null and this run on the interactive branch
		// (same trick init.spec.ts's onConflict-threading tests use).
		vi.mocked(select).mockResolvedValueOnce('').mockResolvedValueOnce('keep');
		vi.mocked(confirm).mockResolvedValueOnce(true); // "Apply?"

		const result = await runInit({ targetDir: tmp, inline: { pm: 'npm' } });

		expect(result).toEqual({ ok: false });
		expect(existsSync(join(tmp, '.editorconfig'))).toBe(true);
		expect(existsSync(join(tmp, STATE_FILENAME))).toBe(true);
	});

	it('writes state then exits 130 when the install-failure prompt is cancelled', async () => {
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-install-failure-cancel-'));
		writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'x', version: '0.0.0' }));
		vi.mocked(unitPicker).mockResolvedValue({ ids: ['core-editorconfig'], flavors: {} });
		mockInstallSpawn(2);

		vi.mocked(select).mockResolvedValueOnce('').mockResolvedValueOnce('rollback');
		vi.mocked(confirm).mockResolvedValueOnce(true); // "Apply?"
		// Driving `select` to resolve the real clack cancel symbol means driving
		// an actual prompt; mocking `isCancel` true for this one call is the
		// documented fallback (install/run.spec.ts). Four isCancel checks land
		// before the one we care about—the preset select, the picker result,
		// "Apply?", then the install-failure prompt itself—so the first three
		// answer false (their real, natural answer) and only the fourth cancels.
		vi.mocked(isCancel).mockReturnValueOnce(false).mockReturnValueOnce(false).mockReturnValueOnce(false).mockReturnValueOnce(true);

		// Unlike a non-throwing stub, this reproduces process.exit's real
		// never-returns behavior—the one thing that actually stops execution
		// after cancelAndExit calls it. Restored in `finally`: this suite has no
		// restoreMocks, so a failed assertion here would otherwise leave
		// process.exit throwing for the rest of the file.
		const exit = vi.spyOn(process, 'exit').mockImplementation(() => {
			throw new Error('process.exit');
		});
		try {
			await expect(runInit({ targetDir: tmp, inline: { pm: 'npm' } })).rejects.toThrow('process.exit');
			expect(exit).toHaveBeenCalledWith(130);
			// Ctrl-C at this prompt keeps the old #114 behavior: the files this
			// run wrote are left in place, and the state file has to be written
			// before the exit or `diff`/`remove` would never learn about them.
			expect(existsSync(join(tmp, '.editorconfig'))).toBe(true);
			expect(existsSync(join(tmp, STATE_FILENAME))).toBe(true);
		}
		finally {
			exit.mockRestore();
		}
	});

	it('is unaffected by the failure machinery when the install actually succeeds', async () => {
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-install-failure-success-'));
		writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'x', version: '0.0.0' }));
		mockInstallSpawn(0);

		// Guards the flag wiring itself: if `failed` ever came back true on a
		// clean install, every run would look like a #114 failure regardless of
		// what actually happened.
		const result = await runInit({ targetDir: tmp, inline: { units: 'core-editorconfig', pm: 'npm', yes: true } });

		expect(result).toEqual({ ok: true });
		expect(existsSync(join(tmp, '.editorconfig'))).toBe(true);
		expect(existsSync(join(tmp, STATE_FILENAME))).toBe(true);
	});
});
