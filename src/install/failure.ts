import type { Pm } from '../detect/pm';
import { isCancel, select } from '@clack/prompts';

// Pure and clack-free, so tests can call it directly. Plain ASCII on purpose:
// nothing here is colorized, so `--no-color` has nothing to strip.
export function formatInstallFailure(pm: Pm, exitCode: number | undefined, addedScripts?: Record<string, string>): string {
	// A spawn that never started (bad PATH, missing binary) has no exit code at
	// all—the sentence still has to read as a complete thought in that case,
	// not trail off into "exit undefined".
	const outcome = exitCode === undefined
		? 'it failed before producing an exit code'
		: `it failed with exit code ${exitCode}`;
	// What became of the written files is the next line's job, not this one's:
	// the branch that follows either keeps them or rolls them back, and a
	// headline that claimed either would be wrong half the time.
	let message = `unbranded ran \`${pm} install\` and ${outcome}.`;

	// A lifecycle script the run merged in outlives the install that failed to
	// set it up: the package manager reads `prepare` off the manifest on every
	// install, with no notion of "the run that added this never finished." A
	// husky hook firing unasked later is the expensive half of #114, so name
	// the scripts rather than let the user find them. Phrased as what the
	// package manager does, not as what will happen next, because a rollback
	// is about to remove them again.
	const scripts = Object.keys(addedScripts ?? {});
	if (scripts.length > 0) {
		const names = scripts.map(s => `\`${s}\``);
		const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
		const noun = scripts.length === 1 ? 'script' : 'scripts';
		const pronoun = scripts.length === 1 ? 'it' : 'them';
		message += ` This run added the ${list} ${noun} to \`package.json\`, and every \`${pm} install\` runs ${pronoun}.`;
	}

	return message;
}

// Pure and clack-free, so tests can call it directly. Plain ASCII on purpose:
// nothing here is colorized, so `--no-color` has nothing to strip.
export function formatKeepLine(pm: Pm, targetDir: string): string {
	return `The files this run wrote are still in \`${targetDir}\`. Fix the install and run \`${pm} install\` there, or restore them with git.`;
}

// Modeled on promptDepConflict (run.ts): same select shape, same isCancel
// check. Returns 'cancel' rather than calling cancelAndExit—the caller
// still owes the state file a write before the process can exit, so the exit
// decision has to stay with the caller rather than happen in here.
export async function promptInstallFailure(): Promise<'keep' | 'rollback' | 'cancel'> {
	const choice = await select<'keep' | 'rollback'>({
		message: 'Install failed. Keep what this run wrote, or roll back?',
		options: [
			{ value: 'keep', label: 'Keep the files', hint: 'leaves the files and the state file in place so you can fix the install and re-run it' },
			{ value: 'rollback', label: 'Roll back', hint: 'restores every file this run changed to its pre-run contents and deletes the ones it created; leaves node_modules and the lockfile alone' },
		],
	});
	if (isCancel(choice))
		return 'cancel';
	return choice;
}

// Modeled on resolveDepConflict (run.ts) and the seam a future
// `--on-install-failure` flag plugs into: a set policy short-circuits the
// prompt, the same contract `--on-conflict` has for files.
export async function resolveInstallFailure(policy: 'keep' | 'rollback' | undefined): Promise<'keep' | 'rollback' | 'cancel'> {
	if (policy === undefined)
		return promptInstallFailure();
	return policy;
}
