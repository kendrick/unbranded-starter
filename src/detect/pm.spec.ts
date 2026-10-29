import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { detectPm, inspectPm, NO_PM_MESSAGE } from './pm';

describe('inspectPm', () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), 'unbranded-pm-'));
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it('returns no-pkg when there is no package.json and no lockfile', () => {
		expect(inspectPm(dir, {})).toEqual({ kind: 'no-pkg' });
	});

	it('detects pnpm from pnpm-lock.yaml', () => {
		writeFileSync(join(dir, 'package.json'), '{}');
		writeFileSync(join(dir, 'pnpm-lock.yaml'), '');
		expect(inspectPm(dir, {})).toMatchObject({
			kind: 'detected',
			pm: 'pnpm',
			source: 'lockfile',
		});
	});

	it('detects npm from package-lock.json', () => {
		writeFileSync(join(dir, 'package.json'), '{}');
		writeFileSync(join(dir, 'package-lock.json'), '');
		expect(inspectPm(dir, {})).toMatchObject({
			kind: 'detected',
			pm: 'npm',
			source: 'lockfile',
		});
	});

	it('detects yarn from yarn.lock', () => {
		writeFileSync(join(dir, 'package.json'), '{}');
		writeFileSync(join(dir, 'yarn.lock'), '');
		expect(inspectPm(dir, {})).toMatchObject({
			kind: 'detected',
			pm: 'yarn',
			source: 'lockfile',
		});
	});

	it('detects bun from bun.lock', () => {
		writeFileSync(join(dir, 'package.json'), '{}');
		writeFileSync(join(dir, 'bun.lock'), '');
		expect(inspectPm(dir, {})).toMatchObject({
			kind: 'detected',
			pm: 'bun',
			source: 'lockfile',
		});
	});

	it('detects bun from bun.lockb (legacy binary lockfile)', () => {
		writeFileSync(join(dir, 'package.json'), '{}');
		writeFileSync(join(dir, 'bun.lockb'), '');
		expect(inspectPm(dir, {})).toMatchObject({ kind: 'detected', pm: 'bun' });
	});

	it('lockfile beats packageManager field', () => {
		writeFileSync(join(dir, 'package.json'), JSON.stringify({ packageManager: 'npm@10.0.0' }));
		writeFileSync(join(dir, 'pnpm-lock.yaml'), '');
		expect(inspectPm(dir, {})).toMatchObject({ kind: 'detected', pm: 'pnpm', source: 'lockfile' });
	});

	it('falls back to packageManager field when no lockfile', () => {
		writeFileSync(join(dir, 'package.json'), JSON.stringify({ packageManager: 'pnpm@10.0.0' }));
		expect(inspectPm(dir, {})).toMatchObject({
			kind: 'detected',
			pm: 'pnpm',
			source: 'packageManager',
			packageManagerField: 'pnpm@10.0.0',
		});
	});

	it('packageManager field beats user-agent', () => {
		writeFileSync(join(dir, 'package.json'), JSON.stringify({ packageManager: 'pnpm@10.0.0' }));
		const env = { npm_config_user_agent: 'npm/10.0.0 node/v20.0.0' };
		expect(inspectPm(dir, env)).toMatchObject({
			kind: 'detected',
			pm: 'pnpm',
			source: 'packageManager',
		});
	});

	it('falls back to user-agent when no lockfile and no packageManager field', () => {
		writeFileSync(join(dir, 'package.json'), '{}');
		const env = { npm_config_user_agent: 'pnpm/10.0.0 npm/? node/v20.0.0' };
		expect(inspectPm(dir, env)).toMatchObject({
			kind: 'detected',
			pm: 'pnpm',
			source: 'userAgent',
		});
	});

	it('returns needs-prompt when package.json has no signal and no user-agent match', () => {
		writeFileSync(join(dir, 'package.json'), '{}');
		expect(inspectPm(dir, {})).toEqual({ kind: 'needs-prompt' });
	});

	it('ignores malformed packageManager field', () => {
		writeFileSync(join(dir, 'package.json'), JSON.stringify({ packageManager: 'something-else' }));
		expect(inspectPm(dir, {})).toEqual({ kind: 'needs-prompt' });
	});

	it('throws for malformed package.json instead of misclassifying', () => {
		writeFileSync(join(dir, 'package.json'), '{ not json');
		expect(() => inspectPm(dir, {})).toThrow(/Malformed package\.json/);
	});

	it('detects workspace-leaf when pnpm-workspace.yaml is in a parent', () => {
		const leaf = join(dir, 'packages', 'app');
		mkdirSync(leaf, { recursive: true });
		writeFileSync(join(dir, 'pnpm-workspace.yaml'), '');
		writeFileSync(join(leaf, 'package.json'), '{}');
		expect(inspectPm(leaf, {})).toMatchObject({
			kind: 'workspace-leaf',
			workspaceRoot: dir,
		});
	});

	it('does not flag workspace-leaf when pnpm-workspace.yaml is at cwd', () => {
		writeFileSync(join(dir, 'package.json'), '{}');
		writeFileSync(join(dir, 'pnpm-workspace.yaml'), '');
		writeFileSync(join(dir, 'pnpm-lock.yaml'), '');
		expect(inspectPm(dir, {})).toMatchObject({ kind: 'detected', pm: 'pnpm', source: 'lockfile' });
	});

	it('finds lockfile in a parent directory', () => {
		const sub = join(dir, 'src');
		mkdirSync(sub);
		writeFileSync(join(dir, 'package.json'), '{}');
		writeFileSync(join(dir, 'pnpm-lock.yaml'), '');
		expect(inspectPm(sub, {})).toMatchObject({ kind: 'detected', pm: 'pnpm', source: 'lockfile' });
	});

	describe('project signals vs an ancestor lockfile', () => {
		let proj: string;

		beforeEach(() => {
			proj = join(dir, 'proj');
			mkdirSync(proj);
			writeFileSync(
				join(proj, 'package.json'),
				'{"name":"proj","version":"0.0.0","packageManager":"pnpm@10.0.0"}',
			);
		});

		it("prefers the project's packageManager field over an ancestor lockfile", () => {
			writeFileSync(join(dir, 'package-lock.json'), '{}');
			expect(inspectPm(proj, {})).toEqual({
				kind: 'detected',
				pm: 'pnpm',
				source: 'packageManager',
				packageManagerField: 'pnpm@10.0.0',
			});
		});

		it('still lets a lockfile in the project dir beat its packageManager field', () => {
			writeFileSync(join(proj, 'package-lock.json'), '{}');
			expect(inspectPm(proj, {})).toEqual({
				kind: 'detected',
				pm: 'npm',
				source: 'lockfile',
				lockfilePath: join(proj, 'package-lock.json'),
			});
		});

		it('falls back to the ancestor lockfile when the project has no packageManager field', () => {
			writeFileSync(join(dir, 'package-lock.json'), '{}');
			writeFileSync(join(proj, 'package.json'), '{"name":"proj","version":"0.0.0"}');
			expect(inspectPm(proj, {})).toEqual({
				kind: 'detected',
				pm: 'npm',
				source: 'lockfile',
				lockfilePath: join(dir, 'package-lock.json'),
			});
		});

		it('still refuses a workspace leaf that declares packageManager', () => {
			writeFileSync(join(dir, 'pnpm-workspace.yaml'), '');
			expect(inspectPm(proj, {})).toMatchObject({ kind: 'workspace-leaf', workspaceRoot: dir });
		});
	});
});

// New-project mode runs against a freshly created, empty directory: no
// package.json is seeded until later, so the old code took the no-pkg path and
// never reached the user-agent check. These pin the mode-aware behavior.
describe('inspectPm — new mode', () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), 'unbranded-pm-new-'));
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it('honors the user-agent up front, with no prompt', () => {
		const env = { npm_config_user_agent: 'pnpm/9.0.0 npm/? node/v20.0.0' };
		expect(inspectPm(dir, env, 'new')).toEqual({
			kind: 'detected',
			pm: 'pnpm',
			source: 'userAgent',
		});
	});

	it('ignores a decoy lockfile in a parent directory', () => {
		// A stray package-lock.json above a brand-new project is not intent.
		const sub = join(dir, 'nested');
		mkdirSync(sub);
		writeFileSync(join(dir, 'package-lock.json'), '');
		expect(inspectPm(sub, {}, 'new')).toEqual({ kind: 'needs-prompt' });
	});

	it('falls through to the prompt, never no-pkg, when the user-agent is absent', () => {
		expect(inspectPm(dir, {}, 'new')).toEqual({ kind: 'needs-prompt' });
	});

	it('still walks up to a parent lockfile in augment mode (regression)', () => {
		const sub = join(dir, 'src');
		mkdirSync(sub);
		writeFileSync(join(dir, 'package.json'), '{}');
		writeFileSync(join(dir, 'pnpm-lock.yaml'), '');
		expect(inspectPm(sub, {}, 'augment')).toMatchObject({
			kind: 'detected',
			pm: 'pnpm',
			source: 'lockfile',
		});
	});
});

// detectPm's override short-circuits before any filesystem inspection, which is
// exactly what lets `--pm` skip the workspace-leaf refusal inspectPm would raise.
// This is the monorepo-subpackage escape hatch #17 promises.
describe('detectPm — override', () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), 'unbranded-pm-override-'));
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it('bypasses the workspace-leaf refusal when --pm is given', async () => {
		const leaf = join(dir, 'packages', 'app');
		mkdirSync(leaf, { recursive: true });
		writeFileSync(join(dir, 'pnpm-workspace.yaml'), '');
		writeFileSync(join(leaf, 'package.json'), '{}');

		// Without an override this same leaf throws (see the inspectPm case above).
		await expect(detectPm(leaf, { override: 'npm' })).resolves.toBe('npm');
	});

	it('passes a null override straight through, so install is skipped', async () => {
		await expect(detectPm(dir, { override: null })).resolves.toBeNull();
	});
});

// Clack isn't mocked here on purpose: a case that reached select() would hang
// and time out instead of passing, so a missing guard can't go green.
describe('detectPm — non-interactive', () => {
	let dir: string;
	let savedUserAgent: string | undefined;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), 'unbranded-pm-noninteractive-'));
		writeFileSync(join(dir, 'package.json'), '{"name":"p","version":"0.0.0"}');
		savedUserAgent = process.env.npm_config_user_agent;
		delete process.env.npm_config_user_agent;
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
		if (savedUserAgent !== undefined) process.env.npm_config_user_agent = savedUserAgent;
	});

	it('refuses with a message naming --pm when no signal exists', async () => {
		// Pins the precondition, so a stray signal can't turn this into a vacuous pass.
		expect(inspectPm(dir, process.env)).toEqual({ kind: 'needs-prompt' });
		await expect(detectPm(dir, { nonInteractive: true })).rejects.toThrow(/--pm/);
		await expect(detectPm(dir, { nonInteractive: true })).rejects.toThrow(NO_PM_MESSAGE);
	});

	it('still honors a null override', async () => {
		await expect(detectPm(dir, { nonInteractive: true, override: null })).resolves.toBeNull();
	});

	it('still detects from a lockfile', async () => {
		writeFileSync(join(dir, 'pnpm-lock.yaml'), '');
		await expect(detectPm(dir, { nonInteractive: true })).resolves.toBe('pnpm');
	});
});
