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
import { pathToFileURL } from 'node:url';

// Index entries, minus any deleted from disk: a path that no longer exists
// would reach the tools as an error rather than a skip.
export function trackedFiles(cwd) {
	const out = execFileSync('git', ['ls-files', '-z'], { cwd, encoding: 'utf8' });
	return out
		.split('\0')
		.filter(Boolean)
		.filter((p) => existsSync(join(cwd, p)));
}

function toolEntry(pkg) {
	const require = createRequire(import.meta.url);
	const manifestPath = require.resolve(`${pkg}/package.json`);
	const { bin } = JSON.parse(readFileSync(manifestPath, 'utf8'));
	return join(dirname(manifestPath), typeof bin === 'string' ? bin : bin[pkg]);
}

// Same order and short-circuit as `pnpm lint` (`oxlint && oxfmt --check`), so
// the hook fails the way CI would. The tools get the whole list in one argv:
// 302 paths is ~9 KB against Windows' 32,767-char CreateProcess ceiling, so
// there's ~3x headroom before this would need batching. Spawning node on the
// tool's entry point skips cmd.exe, whose 8,191-char limit is the tighter one.
// `--no-error-on-unmatched-pattern` covers a list that's all ignored or
// unsupported files (LICENSE, .sh), where both tools otherwise exit non-zero.
export function lintTracked(cwd = process.cwd()) {
	const files = trackedFiles(cwd);
	if (files.length === 0) return 0;

	const steps = [
		[toolEntry('oxlint'), '--no-error-on-unmatched-pattern'],
		[toolEntry('oxfmt'), '--check', '--no-error-on-unmatched-pattern'],
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

// Import-safe: the spec pulls the functions without running the tools.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
	process.exit(lintTracked());
}
