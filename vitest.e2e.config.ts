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
		// E2E spawns the built CLI and waits on real installs, and the same
		// install swings hard by runner. The react flavor measures ~9s on ubuntu
		// and anywhere from 55s to past 250s on windows, because a real install
		// is tens of thousands of small files and windows charges per file.
		// So treat this as a hang detector rather than a performance assertion:
		// anything set near the windows tail fails on runner weather instead of
		// on the diff, and a synchronous install blocks the event loop anyway,
		// so a tight number cannot even reliably fire.
		testTimeout: 600_000,
		// Teardown deletes a real node_modules tree. That is tens of thousands of
		// small files, and Windows charges per file, so the 10s default is not a
		// budget a passing run reliably fits inside.
		hookTimeout: 60_000,
		// Spawning child processes per test means parallel runs trip over
		// each other (cwd, ports, etc.). Single-threaded is fine here.
		// `fileParallelism: false` pins maxWorkers to 1; it replaces the
		// `poolOptions.forks.singleFork` that vitest 4 removed, and the
		// removal is silent, so a stale spelling reads as green while the
		// suite races itself.
		pool: 'forks',
		fileParallelism: false,
	},
});
