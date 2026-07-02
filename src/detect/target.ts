import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { cancel, confirm, isCancel, text } from '@clack/prompts';
import { cancelAndExit } from '../util/cancel';

export type TargetMode = 'augment' | 'new';

export interface TargetContext {
	dir: string;
	mode: TargetMode;
}

interface AugmentInspection {
	kind: 'augment';
	dir: string;
}

interface NewInspection {
	kind: 'new';
	parent: string;
}

// In augment mode, `dir` is the existing project root. In new mode, `parent`
// is the cwd that will hold a fresh subdirectory once the user names it.
export type Inspection = AugmentInspection | NewInspection;

// Pure check: does this directory look like an existing project? Split from
// the prompt flow so tests can exercise it without mocking clack.
export function inspectTarget(cwd: string): Inspection {
	const pkgPath = join(cwd, 'package.json');
	if (existsSync(pkgPath)) {
		return { kind: 'augment', dir: cwd };
	}
	return { kind: 'new', parent: cwd };
}

// `.` is the in-place sentinel: scaffold into cwd rather than a fresh
// subdirectory. It's accepted even though it isn't a legal npm package name —
// the seeded package.json falls back to basename(cwd) for the real name.
// Shared by the interactive prompt and the config-mode path so both validate
// identically.
export function validateProjectName(value: string | undefined): string | undefined {
	if (!value)
		return 'Required';
	if (value === '.')
		return undefined;
	if (!/^[a-z0-9][a-z0-9_-]*$/.test(value)) {
		return 'Lowercase letters, numbers, hyphens, underscores. Must start with a letter or digit.';
	}
	if (value.length > 214)
		return 'Too long (npm caps package names at 214 chars).';
	return undefined;
}

// What a fresh `git clone` of an empty repo leaves on disk. Scaffolding over
// these is safe: they're repo metadata, not a project we'd be clobbering.
const SAFE_EXISTING_ENTRIES = new Set(['.git', 'README.md', 'LICENSE', '.gitignore']);

// Pure classifier for a named target that already exists. Empty and
// clone-shaped directories are safe to scaffold into (after a confirm);
// anything else we refuse, so the never-clobber default still holds.
export function classifyExistingDir(entries: string[]): 'empty' | 'safe' | 'unsafe' {
	if (entries.length === 0)
		return 'empty';
	return entries.every(e => SAFE_EXISTING_ENTRIES.has(e)) ? 'safe' : 'unsafe';
}

// `projectName`, when supplied, skips the text prompt — config-mode runs
// pass it through so the new-project flow stays non-interactive.
export interface DetectTargetOpts {
	projectName?: string;
}

export async function detectTarget(opts: DetectTargetOpts = {}): Promise<TargetContext> {
	const inspection = inspectTarget(process.cwd());

	if (inspection.kind === 'augment') {
		return { dir: inspection.dir, mode: 'augment' };
	}

	// No package.json — a fresh project. Honor the supplied name (config mode)
	// or ask for one. `interactive` also gates the confirm below: a recipe's
	// projectName is consent already given, so config mode never re-prompts.
	const { projectName } = opts;
	const interactive = projectName === undefined;

	let name: string;
	if (projectName !== undefined) {
		const invalid = validateProjectName(projectName);
		if (invalid) {
			throw new Error(`Invalid projectName ${JSON.stringify(projectName)}: ${invalid}`);
		}
		name = projectName;
	}
	else {
		const prompted = await text({
			message: 'Project name (or "." to scaffold into the current directory)',
			placeholder: 'my-app',
			validate: validateProjectName,
		});

		if (isCancel(prompted)) {
			return cancelAndExit();
		}
		name = prompted;
	}

	// "." scaffolds in place: use cwd as-is, no mkdir/chdir. The run stays
	// mode:'new' so mode-aware PM detection (user-agent, no ancestor walk-up)
	// still applies, and package.json's name defaults to basename(cwd) downstream.
	if (name === '.') {
		return { dir: inspection.parent, mode: 'new' };
	}

	const newDir = resolve(inspection.parent, name);

	// Never clobber by default. A named directory that already exists is only
	// safe to scaffold into when it's empty or holds nothing but clone residue;
	// anything else refuses. Interactive runs confirm first; config mode has
	// already opted in by naming it, but the unsafe refusal is unconditional.
	if (existsSync(newDir)) {
		if (classifyExistingDir(readdirSync(newDir)) === 'unsafe') {
			throw new Error(`Directory already exists and isn't empty: ${newDir}`);
		}
		if (interactive) {
			const proceed = await confirm({
				message: `${newDir} already exists. Scaffold into it?`,
				initialValue: true,
			});
			if (isCancel(proceed)) {
				return cancelAndExit();
			}
			if (!proceed) {
				// A deliberate "no" is a choice, not an abort — exit clean, the way
				// the Apply prompt does, rather than the 130 that Ctrl-C gives.
				cancel('Cancelled.');
				process.exit(0);
			}
		}
	}
	else {
		mkdirSync(newDir);
	}
	process.chdir(newDir);

	return { dir: newDir, mode: 'new' };
}
