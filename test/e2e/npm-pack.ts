import { execSync } from 'node:child_process';
import { PKG_ROOT } from '../../src/util/paths';

interface PackEntry {
	path: string;
}

// Extract packed file paths from raw `npm pack --json` stdout. Pure so the parse
// is unit-testable without spawning npm, whose stream varies by version. npm
// contaminates both ends: node's bundled npm prints `prepare`-hook output ahead
// of the JSON (even with --ignore-scripts), and npm@latest under the publish
// job's setup-node .npmrc emits an `always-auth` deprecation warning AFTER it.
// Bound the payload to the first array-of-objects (`[` then `{`, which the hook's
// `[INFO]`-style lines never form) through the last `]`, so it parses regardless.
export function parsePackedFilePaths(stdout: string): string[] {
	const start = stdout.search(/\[\s*\{/);
	const body = start === -1 ? stdout : stdout.slice(start);
	const end = body.lastIndexOf(']');
	const json = end === -1 ? body : body.slice(0, end + 1);
	const parsed = JSON.parse(json) as { files: PackEntry[] }[];
	const first = parsed[0];
	if (!first)
		throw new Error('npm pack returned no entries');
	return first.files.map(f => f.path);
}

// The packed file paths from `npm pack --dry-run --json` at the package root.
export function packedFilePaths(): string[] {
	const stdout = execSync('npm pack --dry-run --json --ignore-scripts', { cwd: PKG_ROOT, encoding: 'utf-8' });
	return parsePackedFilePaths(stdout);
}
