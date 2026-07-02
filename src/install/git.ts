import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { confirm, isCancel, log } from '@clack/prompts';
import { cancelAndExit } from '../util/cancel';
import { spawnOptions } from './spawn';

export type GitPlan = 'init' | 'init-commit' | 'none';

export interface MaybeInitGitOpts {
	targetDir: string;
	// The recipe's `git` field in config mode. `undefined` means interactive:
	// prompt for the repo and the first commit instead of reading a plan.
	plan?: GitPlan;
}

// Give a fresh project a git repo, before husky's post-install needs one.
// Idempotent by design: an existing `.git` short-circuits the whole thing, so
// re-runs and (the rare) new-mode target that's already a repo stay untouched.
export async function maybeInitGit(opts: MaybeInitGitOpts): Promise<void> {
	if (existsSync(join(opts.targetDir, '.git'))) {
		return;
	}

	let plan: GitPlan;
	if (opts.plan !== undefined) {
		plan = opts.plan;
	}
	else {
		const init = await confirm({ message: 'Initialize a git repository?', initialValue: true });
		if (isCancel(init)) {
			return cancelAndExit();
		}
		if (!init) {
			return;
		}
		const commit = await confirm({ message: 'Create an initial commit?', initialValue: false });
		if (isCancel(commit)) {
			return cancelAndExit();
		}
		plan = commit ? 'init-commit' : 'init';
	}

	if (plan === 'none') {
		return;
	}

	if (!await runGit(opts.targetDir, ['init'])) {
		// A missing or broken git shouldn't sink the run — the files are already
		// written and husky's post-install has its own `.git` gate. Warn and move
		// on so a machine without git still gets a working scaffold.
		log.warn('Skipped git init (is git installed?). The scaffold is otherwise complete.');
		return;
	}

	if (plan === 'init-commit') {
		await runGit(opts.targetDir, ['add', '-A']);
		await runGit(opts.targetDir, ['commit', '-m', 'chore: scaffold with unbranded']);
	}
}

// Resolves to whether git exited cleanly. The 'error' branch (ENOENT when git
// isn't on PATH) resolves false rather than rejecting, so the caller's warn-and-
// continue path handles both a missing binary and a non-zero exit the same way.
function runGit(cwd: string, args: string[]): Promise<boolean> {
	return new Promise((resolve) => {
		const child = spawn('git', args, spawnOptions(cwd));
		child.on('exit', code => resolve(code === 0));
		child.on('error', () => resolve(false));
	});
}
