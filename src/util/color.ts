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

// The env changes that make node's `styleText` (how clack and the picker color)
// agree with computeColorEnabled. styleText reads NO_COLOR/FORCE_COLOR live on
// every call, but it ignores our --no-color/--color flags and, once a flag is in
// play, the stream itself — so we bridge the resolved policy into the two vars it
// does read. A `null` value means "unset". Only the keys that need changing are
// returned, so a plain TTY or an already-set FORCE_COLOR is left untouched.
export function colorEnvPatch(inputs: ColorInputs): Partial<Record<'NO_COLOR' | 'FORCE_COLOR', string | null>> {
	if (computeColorEnabled(inputs)) {
		// A real TTY colors on its own; the lone gap is --color forcing color over a
		// pipe, which styleText can't infer from argv.
		if (!inputs.isTTY && !inputs.env.FORCE_COLOR)
			return { FORCE_COLOR: '1' };
		return {};
	}
	// Color is off. node lets FORCE_COLOR override NO_COLOR (and warns), so an
	// explicit off has to drop it rather than sit NO_COLOR beside it.
	const patch: Record<string, string | null> = {};
	if (inputs.env.FORCE_COLOR)
		patch.FORCE_COLOR = null;
	if (!inputs.env.NO_COLOR)
		patch.NO_COLOR = '1';
	return patch;
}

export function colorEnabled(): boolean {
	return computeColorEnabled(currentInputs());
}

// Called once at startup, before the flow emits anything. Because styleText reads
// the env live, this needs no special ordering relative to the clack import — it
// just has to run before the first styled write.
export function applyColorPolicy(): void {
	for (const [key, value] of Object.entries(colorEnvPatch(currentInputs()))) {
		if (value === null)
			delete process.env[key];
		else
			process.env[key] = value;
	}
}

function currentInputs(): ColorInputs {
	return { env: process.env, argv: process.argv, isTTY: Boolean(process.stdout.isTTY) };
}
