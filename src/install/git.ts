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

// The stdout-capturing sibling of runGit. runGit inherits stdio so it can only
// hand back a boolean; reading `git status --porcelain` needs the output itself,
// so this pipes stdout while keeping spawnOptions' win32 shell handling. Resolves
// null on a non-zero exit or a missing binary — same warn-and-continue posture as
// runGit's false, so a broken git can never mask itself as a clean tree.
export function gitCapture(cwd: string, args: string[]): Promise<string | null> {
	return new Promise((resolve) => {
		const child = spawn('git', args, { ...spawnOptions(cwd), stdio: 'pipe' });
		let out = '';
		child.stdout?.on('data', (chunk: Buffer) => {
			out += chunk.toString();
		});
		child.on('exit', code => resolve(code === 0 ? out : null));
		child.on('error', () => resolve(null));
	});
}

// Porcelain output is one line per changed path; empty (or whitespace-only) means
// a clean tree. Pure so the guard's decision is testable without spawning git.
export function isDirty(porcelain: string): boolean {
	return porcelain.trim().length > 0;
}

// True only when `dir` is a git repo carrying uncommitted changes. A non-repo, a
// clean tree, or a git that won't run all read as false: the dirty-tree guard is
// a safety net, and a net we can't verify shouldn't fire a false alarm. The `.git`
// probe short-circuits the common non-repo case before paying for a spawn.
export async function isDirtyGitTree(dir: string): Promise<boolean> {
	if (!existsSync(join(dir, '.git'))) {
		return false;
	}
	const status = await gitCapture(dir, ['status', '--porcelain']);
	return status !== null && isDirty(status);
}
