#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

// Spawn the real CLI instead of importing it. The import trick would only work
// because cli.ts parses argv at module top level today; the moment it gains a
// main-module guard, an import forwarder becomes a silent no-op. Spawning keeps
// argv[1] pointed at the real entry and forwards exit code and signals.
const cli = fileURLToPath(import.meta.resolve('unbranded'));

const { status, signal } = spawnSync(process.execPath, [cli, ...process.argv.slice(2)], {
	stdio: 'inherit',
});

// Re-raise the child's terminating signal so `create-unbranded` dies the same
// way the CLI did (Ctrl-C stays Ctrl-C for whatever spawned us).
if (signal) {
	process.kill(process.pid, signal);
}

process.exit(status ?? 1);
