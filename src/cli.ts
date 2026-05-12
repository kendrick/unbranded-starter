import { log } from '@clack/prompts';
import { runInit } from './commands/init';

runInit().catch((err: unknown) => {
	// Top-level catch so an exception surfaces as a friendly clack error
	// instead of a raw stack trace. detectPm throws for workspace-leaf and
	// malformed package.json; both want the same treatment.
	log.error(err instanceof Error ? err.message : String(err));
	process.exit(1);
});
