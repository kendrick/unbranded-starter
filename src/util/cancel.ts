import { cancel } from '@clack/prompts';

// The SIGINT convention: 128 + signal number (2). Exiting with this on a
// cancelled prompt lets scripts and CI tell a user abort apart from a clean
// finish (0) or an error (1). Every Ctrl-C in the flow should land here.
export const CANCEL_EXIT = 130;

// `never` return type so callers can `return cancelAndExit()` in any position
// without tripping unreachable-code or missing-return lint.
export function cancelAndExit(message = 'Cancelled.'): never {
	cancel(message);
	return process.exit(CANCEL_EXIT);
}
