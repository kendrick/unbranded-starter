import type { FileOp } from '../manifest/types';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join as joinNative, posix, resolve as resolveNative } from 'node:path';
import { cancel, isCancel, log, select } from '@clack/prompts';
import { createPatch } from 'diff';

export type CopyAction = 'copied' | 'overwrote' | 'skipped';

export interface CopyResult {
	src: string;
	dest: string;
	action: CopyAction;
	reason?: 'identical' | 'user-skip';
}

export interface CopyOptions {
	pkgRoot: string;
	targetDir: string;
	// Substituted into any `{projectName}` token in `dest`. Provided by the
	// new-project flow; absent in augment mode.
	projectName?: string;
	// Non-interactive override for conflicts. Set by --config mode so E2E
	// runs don't hang on a prompt.
	onConflict?: 'overwrite' | 'skip';
}

export async function copyFileOp(op: FileOp, opts: CopyOptions): Promise<CopyResult> {
	// Manifest paths are posix-style for cross-platform authoring. Split on
	// posix.sep and let node:path build the native form for the host.
	const srcPath = joinNative(opts.pkgRoot, ...op.src.split(posix.sep));

	const interpolatedDest = opts.projectName
		? op.dest.replace(/\{projectName\}/g, opts.projectName)
		: op.dest;
	const destBase = resolveNative(opts.targetDir, ...interpolatedDest.split(posix.sep));

	// `rename` swaps just the basename — the directory portion of `dest` still
	// applies. The motivating case: shipped `.gitignore.template` → final
	// `.gitignore`, because npm strips top-level `.gitignore` from tarballs.
	const destPath = op.rename
		? resolveNative(dirname(destBase), op.rename)
		: destBase;

	// Read as buffer, not string. Writing through a string round-trips through
	// the default encoding, which clobbers Windows CRLF inside source files
	// that were authored with mixed line endings.
	const srcBuf = readFileSync(srcPath);

	if (!existsSync(destPath)) {
		writeBuffer(destPath, srcBuf);
		return { src: srcPath, dest: destPath, action: 'copied' };
	}

	// Short-circuit identical files before we waste a prompt on the user.
	const destBuf = readFileSync(destPath);
	if (srcBuf.equals(destBuf)) {
		return { src: srcPath, dest: destPath, action: 'skipped', reason: 'identical' };
	}

	const resolution = opts.onConflict ?? await promptConflict(destPath, srcBuf, destBuf);

	if (resolution === 'overwrite') {
		writeBuffer(destPath, srcBuf);
		return { src: srcPath, dest: destPath, action: 'overwrote' };
	}
	return { src: srcPath, dest: destPath, action: 'skipped', reason: 'user-skip' };
}

function writeBuffer(path: string, buf: Buffer): void {
	// Intermediate dirs may not exist when the manifest writes into a fresh
	// project (e.g. dest='src/components/ui/cn.ts' in a brand-new repo).
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, buf);
}

async function promptConflict(destPath: string, src: Buffer, dest: Buffer): Promise<'overwrite' | 'skip'> {
	const firstChoice = await select<'overwrite' | 'skip' | 'diff'>({
		message: `Conflict: ${destPath} already exists`,
		options: [
			{ value: 'overwrite', label: 'Overwrite' },
			{ value: 'skip', label: 'Skip' },
			{ value: 'diff', label: 'Show diff' },
		],
	});
	if (isCancel(firstChoice)) {
		cancel('Cancelled');
		return process.exit(0);
	}
	if (firstChoice !== 'diff')
		return firstChoice;

	// Render unified diff with red/green +/- lines. `diff.createPatch` produces
	// the standard hunk format; we colorize the prefix characters for the
	// terminal. After showing it, re-prompt without the diff option so the
	// user doesn't loop back to it from itself.
	log.message(colorizeDiff(createPatch(destPath, dest.toString('utf-8'), src.toString('utf-8'), 'existing', 'proposed')));

	const secondChoice = await select<'overwrite' | 'skip'>({
		message: 'Now what?',
		options: [
			{ value: 'overwrite', label: 'Overwrite' },
			{ value: 'skip', label: 'Skip' },
		],
	});
	if (isCancel(secondChoice)) {
		cancel('Cancelled');
		return process.exit(0);
	}
	return secondChoice;
}

function colorizeDiff(patch: string): string {
	return patch.split('\n').map((line) => {
		// Skip the file headers (`+++`, `---`) when coloring; they're metadata
		// rather than content changes.
		if (line.startsWith('+') && !line.startsWith('+++'))
			return `[32m${line}[0m`;
		if (line.startsWith('-') && !line.startsWith('---'))
			return `[31m${line}[0m`;
		if (line.startsWith('@@'))
			return `[36m${line}[0m`;
		return line;
	}).join('\n');
}
