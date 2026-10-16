// The pre-push hook's lint (#188). `pnpm lint` walks the working tree, so an
// untracked scratch file (notes.md, a stray `debugger;`) blocked a push whose
// commits were all clean. This runs the same two tools, in the same order, over
// `git ls-files` only. CI keeps `pnpm lint` on purpose: a fresh checkout has no
// untracked files, so the tree walk and this script agree there, and the walk
// can't drift from what the tools cover by default.
//
//   node scripts/lint-tracked.mjs

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import process from 'node:process';

// Index entries, minus any deleted from disk: a path that no longer exists
// would reach the tools as an error rather than a skip.
export function trackedFiles(cwd) {
	const out = execFileSync('git', ['ls-files', '-z'], { cwd, encoding: 'utf8' });
	return out
		.split('\0')
		.filter(Boolean)
		.filter((p) => existsSync(join(cwd, p)));
}

function binPath(pkg) {
	const require = createRequire(import.meta.url);
	const manifestPath = require.resolve(`${pkg}/package.json`);
	const { bin } = JSON.parse(readFileSync(manifestPath, 'utf8'));
	return join(dirname(manifestPath), typeof bin === 'string' ? bin : bin[pkg]);
}

// Same order and short-circuit as `pnpm lint` (`oxlint && oxfmt --check`), so
// the hook fails the way CI would. The tools get the whole list in one argv:
// the joined list has to stay under Windows' 32,767-char CreateProcess ceiling.
// At ~30 chars a path that's roughly 1,000 files, and the repo sits at about a
// third of that; batch the argv before it gets close. Spawning node on the
// tool's bin script skips cmd.exe, whose 8,191-char limit is the tighter one.
// `--no-error-on-unmatched-pattern` covers a list that's all ignored or
// unsupported files (LICENSE, .sh), where both tools otherwise exit non-zero.
export function lintTracked(cwd = process.cwd()) {
	const files = trackedFiles(cwd);
	if (files.length === 0) return 0;

	const steps = [
		[binPath('oxlint'), '--no-error-on-unmatched-pattern'],
		[binPath('oxfmt'), '--check', '--no-error-on-unmatched-pattern'],
	];
	for (const args of steps) {
		const { status } = spawnSync(process.execPath, [...args, ...files], {
			cwd,
			stdio: 'inherit',
		});
		// null means a signal killed it; that must not read as success.
		const code = status ?? 1;
		if (code !== 0) return code;
	}
	return 0;
}

// Import-safe: the spec pulls the functions without running the tools. Matches
// on the filename, not a URL compare: node resolves import.meta.url to the
// realpath but leaves argv[1] as typed, so a symlinked path (macOS /tmp ->
// /private/tmp) made the compare miss and the hook silently lint nothing.
if (process.argv[1]?.endsWith('lint-tracked.mjs')) {
	process.exit(lintTracked());
}
