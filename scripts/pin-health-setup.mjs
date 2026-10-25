// Installs and builds the target checkout for a pin-health run, and turns a failure into something the agent can work on instead of a dead job. Design: .github/control-loops/pin-health.md.
//
//   node scripts/pin-health-setup.mjs [--target /tmp/pin-health/target.json] [--logs /tmp/pin-health/logs]
//
// A bump that breaks `pnpm install --frozen-lockfile` or `pnpm build` fails CI at exactly this point, so a setup step that died here would leave that bump uninvestigated, with no escalation marker, and every scheduled run would pick it again (PR #235 review). On failure this writes the output's tail to a log, adds a `setupFailure` entry to the target, writes `ok=false` to GITHUB_OUTPUT, and exits 0. `setup` takes its process runner as an argument, so the spec drives it without a real pnpm.

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

export const STEPS = [
	['pnpm', ['install', '--frozen-lockfile']],
	['pnpm', ['build']],
];
const LOG_TAIL_LINES = 300;
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

export function withSetupFailure(target, { command, exitCode, log }) {
	return { ...target, setupFailure: { command, exitCode, log } };
}

// The loop itself, with the process runner injected so the spec runs on any OS. `run(cmd, args)` returns { status, output }. Returns true when both steps pass.
export function setup({ targetPath, logs, run, githubOutput }) {
	for (const [cmd, args] of STEPS) {
		const command = `${cmd} ${args.join(' ')}`;
		process.stdout.write(`▶ ${command}\n`);
		const { status, output } = run(cmd, args);
		process.stdout.write(output);
		if (status === 0) continue;

		mkdirSync(logs, { recursive: true });
		const log = join(logs, 'setup.log');
		writeFileSync(log, output.replace(ANSI, '').split('\n').slice(-LOG_TAIL_LINES).join('\n'));
		const target = JSON.parse(readFileSync(targetPath, 'utf-8'));
		writeFileSync(
			targetPath,
			`${JSON.stringify(withSetupFailure(target, { command, exitCode: status, log }), null, '\t')}\n`,
		);
		process.stdout.write(
			`::warning::${command} failed on the target branch; the agent gets the log at ${log}.\n`,
		);
		if (githubOutput) writeFileSync(githubOutput, 'ok=false\n', { flag: 'a' });
		return false;
	}
	if (githubOutput) writeFileSync(githubOutput, 'ok=true\n', { flag: 'a' });
	return true;
}

function spawnRun(cmd, args) {
	const proc = spawnSync(cmd, args, { encoding: 'utf-8', maxBuffer: 256 * 1024 * 1024 });
	return {
		status: proc.status,
		output: `${proc.stdout ?? ''}${proc.stderr ?? ''}${proc.error ? `\n${proc.error.message}\n` : ''}`,
	};
}

function main() {
	const flags = process.argv.slice(2);
	const opt = (name, fallback) => {
		const at = flags.indexOf(name);
		return at === -1 ? fallback : flags[at + 1];
	};
	setup({
		targetPath: opt('--target', '/tmp/pin-health/target.json'),
		logs: opt('--logs', '/tmp/pin-health/logs'),
		run: spawnRun,
		githubOutput: process.env.GITHUB_OUTPUT,
	});
}

if (process.argv[1]?.endsWith('pin-health-setup.mjs')) main();
