import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { confirm, isCancel, log } from '@clack/prompts';
import type { Pm } from '../detect/pm';
import type { PostInstall, Unit } from '../manifest/types';

export interface PostInstallOpts {
	targetDir: string;
	pm: Pm;
	units: Unit[];
	// Non-interactive answer for every prompt. 'all' runs every hook whose
	// precondition passes; 'none' skips them. Config-mode wires this in.
	auto?: 'all' | 'none';
}

export interface PostInstallSummary {
	ran: string[];
	skipped: string[];
	failed: { id: string; error: string }[];
}

export async function runPostInstalls(opts: PostInstallOpts): Promise<PostInstallSummary> {
	const summary: PostInstallSummary = { ran: [], skipped: [], failed: [] };

	for (const unit of opts.units) {
		if (!unit.postInstall?.length) continue;
		for (const pi of unit.postInstall) {
			// Hard preconditions first — no point confirming if we'd refuse anyway.
			if (pi.requires === 'git' && !existsSync(join(opts.targetDir, '.git'))) {
				log.warn(`Skipped ${pi.id}: no .git/ directory.`);
				summary.skipped.push(pi.id);
				continue;
			}

			let ok: boolean;
			if (opts.auto !== undefined) {
				ok = opts.auto === 'all';
			}
			else {
				const answer = await confirm({
					message: pi.prompt,
					initialValue: pi.default,
				});
				if (isCancel(answer)) {
					summary.skipped.push(pi.id);
					continue;
				}
				ok = answer;
			}
			if (!ok) {
				summary.skipped.push(pi.id);
				continue;
			}

			const result = await runOne(opts.targetDir, opts.pm, pi);
			if (result.ok) summary.ran.push(pi.id);
			else summary.failed.push({ id: pi.id, error: result.error });
		}
	}

	return summary;
}

// Translate a (binary, args) tuple into the right invocation for the detected
// PM. Authors get to write `['husky', 'init']` once and stay PM-agnostic; the
// runtime adds `pnpm exec`, `npm exec --`, `yarn exec`, or `bun x`.
export function buildCommand(pm: Pm, command: readonly string[]): { bin: string; args: string[] } {
	switch (pm) {
		case 'pnpm': return { bin: 'pnpm', args: ['exec', ...command] };
		case 'npm': return { bin: 'npm', args: ['exec', '--', ...command] };
		case 'yarn': return { bin: 'yarn', args: ['exec', ...command] };
		case 'bun': return { bin: 'bun', args: ['x', ...command] };
	}
}

interface RunResult {
	ok: boolean;
	error: string;
}

function runOne(cwd: string, pm: Pm, pi: PostInstall): Promise<RunResult> {
	const { bin, args } = buildCommand(pm, pi.command);
	// log.step renders a small marker before the child writes its own output.
	// We deliberately don't wrap this in a spinner — post-install commands
	// (husky init, playwright install) have informative output worth seeing.
	log.step(`${pi.id}: ${bin} ${args.join(' ')}`);

	return new Promise((resolve) => {
		const child = spawn(bin, args, { cwd, stdio: 'inherit' });

		// Same SIGINT discipline as install/run.ts: SIGTERM first, escalate
		// to SIGKILL after 5s if the child ignores it. .unref() lets us exit
		// cleanly if the child shuts down before the timer fires.
		const onSigint = (): void => {
			child.kill('SIGTERM');
			setTimeout(() => {
				if (!child.killed) child.kill('SIGKILL');
			}, 5000).unref();
		};
		process.on('SIGINT', onSigint);

		child.on('exit', (code) => {
			process.off('SIGINT', onSigint);
			resolve({ ok: code === 0, error: code === 0 ? '' : `exit ${code}` });
		});

		child.on('error', (err) => {
			process.off('SIGINT', onSigint);
			resolve({ ok: false, error: err.message });
		});
	});
}
