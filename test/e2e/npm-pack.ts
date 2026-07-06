import { execSync } from 'node:child_process';
import { PKG_ROOT } from '../../src/util/paths';

interface PackEntry {
	path: string;
}

// The packed file paths from `npm pack --dry-run --json` at the package root.
// node 22's bundled npm runs the `prepare` hook during pack even with
// --ignore-scripts, printing hook output ahead of the JSON; slicing from the first
// array-of-objects (`[` then `{`, which the hook's `[INFO]`-style lines never form)
// parses the payload regardless of npm version. That's what lets CI skip a global
// `npm install -g npm@latest` just to satisfy these two tests.
export function packedFilePaths(): string[] {
	const stdout = execSync('npm pack --dry-run --json --ignore-scripts', { cwd: PKG_ROOT, encoding: 'utf-8' });
	const start = stdout.search(/\[\s*\{/);
	const parsed = JSON.parse(start === -1 ? stdout : stdout.slice(start)) as { files: PackEntry[] }[];
	const first = parsed[0];
	if (!first)
		throw new Error('npm pack returned no entries');
	return first.files.map(f => f.path);
}
