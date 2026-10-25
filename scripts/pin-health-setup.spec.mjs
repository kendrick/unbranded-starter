import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { setup, withSetupFailure } from './pin-health-setup.mjs';

// Drives setup() with a fake runner, so this runs on every OS in the checks grid. `failOn` names the pnpm subcommand that exits 1.
function runSetup(failOn) {
	const root = mkdtempSync(join(tmpdir(), 'pin-health-setup-'));
	const targetPath = join(root, 'target.json');
	writeFileSync(targetPath, JSON.stringify({ target: 'bump-pr', pr: { number: 7 } }));
	const githubOutput = join(root, 'github-output');
	writeFileSync(githubOutput, '');
	const calls = [];
	const run = (cmd, args) => {
		calls.push(`${cmd} ${args.join(' ')}`);
		return args[0] === failOn
			? { status: 1, output: ' ERR_PNPM_OUTDATED_LOCKFILE  Cannot install with frozen-lockfile\n' }
			: { status: 0, output: 'ok\n' };
	};
	const ok = setup({ targetPath, logs: join(root, 'logs'), run, githubOutput });
	return {
		ok,
		calls,
		output: readFileSync(githubOutput, 'utf-8'),
		target: JSON.parse(readFileSync(targetPath, 'utf-8')),
	};
}

describe('withSetupFailure', () => {
	it('adds the failure to the target and keeps everything else', () => {
		expect(
			withSetupFailure(
				{ target: 'bump-pr', unit: 'u' },
				{ command: 'pnpm build', exitCode: 2, log: '/l' },
			),
		).toEqual({
			target: 'bump-pr',
			unit: 'u',
			setupFailure: { command: 'pnpm build', exitCode: 2, log: '/l' },
		});
	});
});

describe('setup', () => {
	// PR #235 review: a bump that broke its own install killed the checkout step, so the agent never ran and no escalation marker was written.
	it('records a failed install for the agent and reports ok=false', () => {
		const r = runSetup('install');
		expect(r.ok).toBe(false);
		expect(r.output).toBe('ok=false\n');
		expect(r.calls).toEqual(['pnpm install --frozen-lockfile']);
		expect(r.target.setupFailure).toMatchObject({
			command: 'pnpm install --frozen-lockfile',
			exitCode: 1,
		});
		expect(readFileSync(r.target.setupFailure.log, 'utf-8')).toContain(
			'ERR_PNPM_OUTDATED_LOCKFILE',
		);
		expect(r.target.pr).toEqual({ number: 7 });
	});

	it('runs the build after a good install, and records the build when it fails', () => {
		const r = runSetup('build');
		expect(r.calls).toEqual(['pnpm install --frozen-lockfile', 'pnpm build']);
		expect(r.target.setupFailure.command).toBe('pnpm build');
	});

	it('leaves the target alone when both pass', () => {
		const r = runSetup(undefined);
		expect(r.ok).toBe(true);
		expect(r.output).toBe('ok=true\n');
		expect(r.target.setupFailure).toBeUndefined();
	});
});
