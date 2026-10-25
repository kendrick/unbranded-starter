import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { withSetupFailure } from './pin-health-setup.mjs';

const SETUP = resolve('scripts/pin-health-setup.mjs');

// Runs the real script with a pnpm stub on PATH. `failOn` names the pnpm subcommand that exits 1.
function runSetup(failOn) {
	const root = mkdtempSync(join(tmpdir(), 'pin-health-setup-'));
	const bin = join(root, 'bin');
	execFileSync('mkdir', ['-p', bin]);
	writeFileSync(
		join(bin, 'pnpm'),
		`#!/usr/bin/env bash\necho "pnpm $*" >> "${root}/calls"\nif [ "$1" = "${failOn ?? 'never'}" ]; then echo " ERR_PNPM_OUTDATED_LOCKFILE  Cannot install with frozen-lockfile" >&2; exit 1; fi\necho ok\n`,
	);
	chmodSync(join(bin, 'pnpm'), 0o755);
	const target = join(root, 'target.json');
	writeFileSync(target, JSON.stringify({ target: 'bump-pr', pr: { number: 7 } }));
	const output = join(root, 'github-output');
	writeFileSync(output, '');
	execFileSync(process.execPath, [SETUP, '--target', target, '--logs', join(root, 'logs')], {
		env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, GITHUB_OUTPUT: output },
		encoding: 'utf-8',
	});
	const read = (p) => readFileSync(p, 'utf-8');
	return {
		calls: read(join(root, 'calls')),
		output: read(output),
		target: JSON.parse(read(target)),
		root,
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

describe('pin-health-setup.mjs', () => {
	// PR #235 review: a bump that broke its own install killed the checkout step, so the agent never ran and no escalation marker was written.
	it('records a failed install for the agent and exits 0', () => {
		const r = runSetup('install');
		expect(r.output).toBe('ok=false\n');
		expect(r.calls).toBe('pnpm install --frozen-lockfile\n');
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
		expect(r.calls).toBe('pnpm install --frozen-lockfile\npnpm build\n');
		expect(r.target.setupFailure.command).toBe('pnpm build');
	});

	it('leaves the target alone when both pass', () => {
		const r = runSetup(undefined);
		expect(r.output).toBe('ok=true\n');
		expect(r.target.setupFailure).toBeUndefined();
	});
});
