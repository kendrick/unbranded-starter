// The pin-health loop's scope guard. The repair-pin-bump skill tells the agent where it may write, but a skill is only advice, so the workflow runs this check over the agent's uncommitted changes before anything gets committed. Design: .github/control-loops/pin-health.md.
//
//   node scripts/pin-health-scope-guard.mjs [--expect-head <sha>]
//
// Exits 1 and names each offending path or line when the agent wrote outside SCOPE, deleted a spec, or added a skip or an env gate to one. The pure pieces are exported for the spec.

import { execFileSync } from 'node:child_process';
import process from 'node:process';

// The only paths the actuator may change. This list is the single source of truth: the skill points here instead of restating it.
export const SCOPE = [
	'src/manifest/**',
	'templates/**',
	'opt-in/**',
	'presets/**',
	'postcss.config.mjs',
	'stylelint.config.mjs',
	'src/**/*.spec.ts',
	'test/e2e/*.spec.ts',
	'package.json',
	'pnpm-lock.yaml',
	'.github/agent-memory/pin-health.md',
];

const SPEC = /\.spec\.(?:ts|mjs)$/;

// A red e2e can always be turned green by not running it. Each of these is a way to stop running a spec, so an added line that matches one fails the guard.
export const GATING_PATTERNS = [
	/\.(?:skip|todo)\s*\(/,
	/\.(?:skipIf|runIf)\s*\(/,
	/\bxit\s*\(|\bxdescribe\s*\(/,
	/process\.env\.UB_/,
];

export function globToRegExp(glob) {
	let out = '';
	for (let i = 0; i < glob.length; i++) {
		const c = glob[i];
		if (c === '*' && glob[i + 1] === '*') {
			// `**/` may match zero directories, so `src/**/*.spec.ts` covers `src/a.spec.ts` too.
			if (glob[i + 2] === '/') {
				out += '(?:.*/)?';
				i += 2;
			} else {
				out += '.*';
				i += 1;
			}
		} else if (c === '*') {
			out += '[^/]*';
		} else {
			out += c.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
		}
	}
	return new RegExp(`^${out}$`);
}

export function inScope(path, scope = SCOPE) {
	return scope.some((glob) => globToRegExp(glob).test(path));
}

// `git status --porcelain=v1 -z` → [{ status, path }]. A rename carries its old path as a second NUL field, and both sides count: renaming a file out of scope is as much a change to it as editing it.
export function parsePorcelain(raw) {
	const entries = [];
	const fields = raw.split('\0').filter(Boolean);
	for (let i = 0; i < fields.length; i++) {
		const status = fields[i].slice(0, 2);
		const path = fields[i].slice(3);
		entries.push({ status, path });
		if (status.includes('R') || status.includes('C')) {
			entries.push({ status, path: fields[i + 1] });
			i += 1;
		}
	}
	return entries;
}

// `git diff -U0` output → { path: [added lines] }, for the spec files only.
export function addedSpecLines(diff) {
	const added = {};
	let current;
	for (const line of diff.split('\n')) {
		if (line.startsWith('+++ ')) {
			const path = line.slice(4).replace(/^b\//, '');
			current = SPEC.test(path) ? path : undefined;
			if (current) added[current] ??= [];
			continue;
		}
		if (current && line.startsWith('+')) added[current].push(line.slice(1));
	}
	return added;
}

export function checkScope({ entries, addedLines, scope = SCOPE }) {
	const problems = [];
	for (const { status, path } of entries) {
		if (!inScope(path, scope)) problems.push(`${path}: outside the pin-health scope`);
		else if (status.includes('D') && SPEC.test(path)) problems.push(`${path}: deletes a spec`);
	}
	for (const [path, lines] of Object.entries(addedLines)) {
		for (const line of lines) {
			if (GATING_PATTERNS.some((re) => re.test(line))) {
				problems.push(`${path}: adds a skip or env gate: ${line.trim()}`);
			}
		}
	}
	return problems;
}

function git(args) {
	return execFileSync('git', args, { encoding: 'utf-8' });
}

function main() {
	const flags = process.argv.slice(2);
	const expectAt = flags.indexOf('--expect-head');
	const problems = [];

	// The agent has no commit permission, so HEAD moving means something got around the allowlist.
	if (expectAt !== -1) {
		const head = git(['rev-parse', 'HEAD']).trim();
		if (head !== flags[expectAt + 1])
			problems.push(`HEAD moved to ${head}; the actuator must not commit`);
	}

	// Untracked files show up as `??` entries here. `git diff` can't see them, so the next line stages them intent-to-add.
	const entries = parsePorcelain(git(['status', '--porcelain=v1', '-z', '--untracked-files=all']));
	const untracked = entries.filter((e) => e.status === '??').map((e) => e.path);
	if (untracked.length > 0) git(['add', '--intent-to-add', '--', ...untracked]);
	const addedLines = addedSpecLines(git(['diff', '-U0', 'HEAD']));

	problems.push(...checkScope({ entries, addedLines }));
	if (problems.length > 0) {
		process.stderr.write(
			`pin-health scope guard failed:\n${problems.map((p) => `  ${p}`).join('\n')}\n`,
		);
		process.exit(1);
	}
	process.stdout.write(
		`pin-health scope guard: ${entries.length} changed path(s), all in scope.\n`,
	);
}

if (process.argv[1]?.endsWith('pin-health-scope-guard.mjs')) main();
