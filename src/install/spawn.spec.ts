import { describe, expect, it } from 'vitest';
import { spawnOptions } from './spawn';

describe('spawnOptions', () => {
	it('runs through the shell on Windows so .cmd shims resolve', () => {
		// pnpm/npm/yarn/bun are .cmd shims on Windows; spawn can't exec them
		// without a shell (EINVAL since CVE-2024-27980).
		expect(spawnOptions('/work', 'win32')).toMatchObject({
			cwd: '/work',
			stdio: 'inherit',
			shell: true,
		});
	});

	it('spawns the bare binary on POSIX (no shell)', () => {
		expect(spawnOptions('/work', 'linux').shell).toBe(false);
		expect(spawnOptions('/work', 'darwin').shell).toBe(false);
	});
});
