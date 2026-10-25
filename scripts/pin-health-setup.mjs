// Installs and builds the target checkout for a pin-health run, and turns a failure into something the agent can work on instead of a dead job. Design: .github/control-loops/pin-health.md.
//
//   node scripts/pin-health-setup.mjs [--target /tmp/pin-health/target.json] [--logs /tmp/pin-health/logs]
//
// A bump that breaks `pnpm install --frozen-lockfile` or `pnpm build` fails CI at exactly this point, so a setup step that died here would leave that bump uninvestigated, with no escalation marker, and every scheduled run would pick it again (PR #235 review). On failure this writes the output's tail to a log, adds a `setupFailure` entry to the target, writes `ok=false` to GITHUB_OUTPUT, and exits 0. The pure piece is exported for the spec.

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

function main() {
	const flags = process.argv.slice(2);
	const opt = (name, fallback) => {
		const at = flags.indexOf(name);
		return at === -1 ? fallback : flags[at + 1];
	};
	const targetPath = opt('--target', '/tmp/pin-health/target.json');
	const logs = opt('--logs', '/tmp/pin-health/logs');

	for (const [cmd, args] of STEPS) {
		const command = `${cmd} ${args.join(' ')}`;
		process.stdout.write(`▶ ${command}\n`);
		const proc = spawnSync(cmd, args, { encoding: 'utf-8', maxBuffer: 256 * 1024 * 1024 });
		const output = `${proc.stdout ?? ''}${proc.stderr ?? ''}${proc.error ? `\n${proc.error.message}\n` : ''}`;
		process.stdout.write(output);
		if (proc.status === 0) continue;

		mkdirSync(logs, { recursive: true });
		const log = join(logs, 'setup.log');
		writeFileSync(log, output.replace(ANSI, '').split('\n').slice(-LOG_TAIL_LINES).join('\n'));
		const target = JSON.parse(readFileSync(targetPath, 'utf-8'));
		writeFileSync(
			targetPath,
			`${JSON.stringify(withSetupFailure(target, { command, exitCode: proc.status, log }), null, '\t')}\n`,
		);
		process.stdout.write(
			`::warning::${command} failed on the target branch; the agent gets the log at ${log}.\n`,
		);
		if (process.env.GITHUB_OUTPUT)
			writeFileSync(process.env.GITHUB_OUTPUT, 'ok=false\n', { flag: 'a' });
		return;
	}
	if (process.env.GITHUB_OUTPUT)
		writeFileSync(process.env.GITHUB_OUTPUT, 'ok=true\n', { flag: 'a' });
}

if (process.argv[1]?.endsWith('pin-health-setup.mjs')) main();
