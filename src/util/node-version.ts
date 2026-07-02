// npm only *warns* on an unmet `engines.node`, so a too-old runtime still runs
// the CLI and blows up deep in execution with a raw stack trace. Checking the
// version ourselves lets cli.ts fail up front with one readable line. Kept pure
// (string in, string-or-null out) so the exit path can be unit-tested without
// spawning a subprocess.
export function nodeVersionError(currentVersion: string, floorMajor: number): string | null {
	const major = Number.parseInt(currentVersion, 10);
	if (Number.isNaN(major) || major >= floorMajor)
		return null;

	return `unbranded requires Node ${floorMajor} or newer, but you're running v${currentVersion}.`;
}
