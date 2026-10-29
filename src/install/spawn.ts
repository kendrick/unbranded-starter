import type { SpawnOptions } from 'node:child_process';

// Package-manager binaries are `.cmd` shims on Windows, and since
// CVE-2024-27980 child_process.spawn refuses to execute a `.cmd` without a
// shell (it throws EINVAL). Running through the shell lets cmd.exe resolve the
// shim via PATHEXT. POSIX spawns the bare binary directly. The subcommands we
// pass (`install`, `exec husky init`, ...) carry no shell metacharacters, so
// shell mode needs no extra quoting here. Only package-manager callers (run.ts,
// post.ts, node-version.ts) use this. git.ts builds its own options because the
// shell would re-split a commit message with spaces.
export function spawnOptions(
	cwd: string,
	platform: NodeJS.Platform = process.platform,
): SpawnOptions {
	return { cwd, stdio: 'inherit', shell: platform === 'win32' };
}
