import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { cancel, isCancel, text } from '@clack/prompts';

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

	// No package.json. The user is starting fresh. Either honor the supplied
	// name or ask for one, then create the directory and chdir so subsequent
	// file ops resolve relative to it.
	let name: string;
	if (opts.projectName) {
		name = opts.projectName;
	}
	else {
		const prompted = await text({
			message: 'Project name',
			placeholder: 'my-app',
			validate(value) {
				if (!value) return 'Required';
				if (!/^[a-z0-9][a-z0-9_-]*$/.test(value)) {
					return 'Lowercase letters, numbers, hyphens, underscores. Must start with a letter or digit.';
				}
				if (value.length > 214) return 'Too long (npm caps package names at 214 chars).';
				return undefined;
			},
		});

		if (isCancel(prompted)) {
			cancel('Cancelled');
			return process.exit(0);
		}
		name = prompted;
	}

	const newDir = resolve(inspection.parent, name);

	// Refuse to write into an existing directory, even an empty one. The
	// default has to be "never clobber"; a confirm-to-overwrite flow can be
	// added later if it earns its weight.
	if (existsSync(newDir)) {
		throw new Error(`Directory already exists: ${newDir}`);
	}

	mkdirSync(newDir);
	process.chdir(newDir);

	return { dir: newDir, mode: 'new' };
}
