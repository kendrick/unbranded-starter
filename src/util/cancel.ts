import { cancel } from '@clack/prompts';
import { EXIT_CANCELLED } from './exit-codes';

// Kept as an alias for existing imports; the value lives in exit-codes.ts,
// the contract's single table.
export const CANCEL_EXIT = EXIT_CANCELLED;

// `never` return type so callers can `return cancelAndExit()` in any position
// without tripping unreachable-code or missing-return lint. Every Ctrl-C in
// the flow should land here.
export function cancelAndExit(message = 'Cancelled.'): never {
	cancel(message);
	return process.exit(EXIT_CANCELLED);
}
