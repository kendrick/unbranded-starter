// One color decision the whole CLI shares. Our own ANSI (the diff colorizer, the
// picker theme) reads `colorEnabled()`; clack's picocolors reads the NO_COLOR env
// that `applyColorPolicy()` sets. Keeping the rule pure and in one place is what
// lets `list`, `diff`, `doctor`, `--dry-run`, and the interactive flow agree.

export interface ColorInputs {
	env: Record<string, string | undefined>;
	argv: string[];
	isTTY: boolean;
}

// Precedence mirrors the NO_COLOR standard: an explicit off beats an explicit on,
// and with neither set we follow the stream. We deliberately DROP picocolors' `CI`
// and win32 forcing — this CLI treats a pipe as plain output even in CI, which is
// what makes piped output safe to redirect into a file or another program.
export function computeColorEnabled({ env, argv, isTTY }: ColorInputs): boolean {
	if (env.NO_COLOR || argv.includes('--no-color'))
		return false;
	if (env.FORCE_COLOR || argv.includes('--color'))
		return true;
	return isTTY;
}

export function colorEnabled(): boolean {
	return computeColorEnabled({
		env: process.env,
		argv: process.argv,
		isTTY: Boolean(process.stdout.isTTY),
	});
}

// Called once by the cli launcher BEFORE @clack/prompts (hence picocolors) is
// imported. picocolors freezes its color decision at import time and would force
// color on under CI even when piped; setting NO_COLOR first makes clack honor the
// same policy the rest of the CLI uses. Only ever forces OFF, and never clobbers a
// NO_COLOR the user set themselves.
export function applyColorPolicy(): void {
	if (!colorEnabled() && !process.env.NO_COLOR)
		process.env.NO_COLOR = '1';
}
