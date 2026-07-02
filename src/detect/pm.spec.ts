import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { inspectPm } from './pm';

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
		expect(inspectPm(dir, env)).toMatchObject({ kind: 'detected', pm: 'pnpm', source: 'packageManager' });
	});

	it('falls back to user-agent when no lockfile and no packageManager field', () => {
		writeFileSync(join(dir, 'package.json'), '{}');
		const env = { npm_config_user_agent: 'pnpm/10.0.0 npm/? node/v20.0.0' };
		expect(inspectPm(dir, env)).toMatchObject({ kind: 'detected', pm: 'pnpm', source: 'userAgent' });
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
		expect(inspectPm(dir, env, 'new')).toEqual({ kind: 'detected', pm: 'pnpm', source: 'userAgent' });
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
		expect(inspectPm(sub, {}, 'augment')).toMatchObject({ kind: 'detected', pm: 'pnpm', source: 'lockfile' });
	});
});
