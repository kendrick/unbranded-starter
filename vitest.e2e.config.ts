import { defineConfig } from 'vitest/config';

// E2E suite. Separate from vitest.config.ts so:
// - `pnpm test` stays fast and stays out of the spawn business.
// - We can use `environment: 'node'` instead of jsdom — these tests spawn
//   child processes and inspect files, no DOM in sight.
// - This file isn't shipped to user projects (only vitest.config.ts is).
export default defineConfig({
	test: {
		environment: 'node',
		include: ['test/e2e/**/*.spec.ts'],
		// E2E spawns the built CLI and waits on installs; the default 5s
		// timeout is too tight for the install paths.
		testTimeout: 60_000,
		// Spawning child processes per test means parallel runs trip over
		// each other (cwd, ports, etc.). Single-threaded is fine here.
		pool: 'forks',
		poolOptions: { forks: { singleFork: true } },
	},
});
