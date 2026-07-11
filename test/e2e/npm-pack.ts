import { execSync } from 'node:child_process';
import { PKG_ROOT } from '../../src/util/paths';

interface PackEntry {
	path: string;
}

interface PackRecord {
	files: PackEntry[];
}

// Carve the JSON payload out of `npm pack --json` stdout. npm brackets it with
// noise that varies by version: some builds run the `prepare` hook during pack
// (even with --ignore-scripts) and print hook lines ahead of it, and warnings can
// trail it. Find the first real JSON opener (`[` then `{`, or `{` then `"`, which
// `[INFO]`/`> prepare` lines never form) and walk to its matching close, tracking
// string literals, so leading and trailing noise both fall away.
function extractJsonPayload(stdout: string): string {
	const start = stdout.search(/\[\s*\{|\{\s*"/);
	if (start === -1)
		throw new Error('npm pack produced no JSON payload');
	let depth = 0;
	let inString = false;
	let escaped = false;
	for (let i = start; i < stdout.length; i++) {
		const ch = stdout[i];
		if (inString) {
			if (escaped)
				escaped = false;
			else if (ch === '\\')
				escaped = true;
			else if (ch === '"')
				inString = false;
			continue;
		}
		if (ch === '"') {
			inString = true;
		}
		else if (ch === '[' || ch === '{') {
			depth++;
		}
		else if (ch === ']' || ch === '}') {
			depth--;
			if (depth === 0)
				return stdout.slice(start, i + 1);
		}
	}
	throw new Error('npm pack JSON payload was not balanced');
}

// Read the packed file paths from raw `npm pack --json` stdout. Pure so the parse
// is unit-testable without spawning npm. The wrapper shape moved across majors:
// npm <=11 returns an array ([{...}]), npm 12 a bare object keyed by package name
// ({ "<pkg>": {...} }). Both hold one record with a `files` list; normalize to it.
export function parsePackedFilePaths(stdout: string): string[] {
	const parsed = JSON.parse(extractJsonPayload(stdout)) as PackRecord[] | Record<string, PackRecord>;
	const record = Array.isArray(parsed) ? parsed[0] : Object.values(parsed)[0];
	if (!record || !Array.isArray(record.files))
		throw new Error('npm pack returned no file list');
	return record.files.map(f => f.path);
}

// The packed file paths from `npm pack --dry-run --json` at the package root.
export function packedFilePaths(): string[] {
	const stdout = execSync('npm pack --dry-run --json --ignore-scripts', { cwd: PKG_ROOT, encoding: 'utf-8' });
	return parsePackedFilePaths(stdout);
}
