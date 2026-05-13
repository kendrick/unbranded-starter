import { describe, expect, it } from 'vitest';
import { buildCommand } from './post';

describe('buildCommand', () => {
	it('wraps with `pnpm exec` for pnpm', () => {
		expect(buildCommand('pnpm', ['husky', 'init'])).toEqual({
			bin: 'pnpm',
			args: ['exec', 'husky', 'init'],
		});
	});

	it('wraps with `npm exec --` for npm', () => {
		// The `--` separator stops npm from interpreting subsequent flags
		// as its own options; matters when the binary takes args like
		// `playwright install --with-deps`.
		expect(buildCommand('npm', ['playwright', 'install', '--with-deps'])).toEqual({
			bin: 'npm',
			args: ['exec', '--', 'playwright', 'install', '--with-deps'],
		});
	});

	it('wraps with `yarn exec` for yarn', () => {
		expect(buildCommand('yarn', ['husky', 'init'])).toEqual({
			bin: 'yarn',
			args: ['exec', 'husky', 'init'],
		});
	});

	it('wraps with `bun x` for bun', () => {
		// Bun uses `x` rather than `exec` for the same purpose.
		expect(buildCommand('bun', ['husky', 'init'])).toEqual({
			bin: 'bun',
			args: ['x', 'husky', 'init'],
		});
	});

	it('passes additional args through unchanged', () => {
		expect(buildCommand('pnpm', ['playwright', 'install', '--with-deps'])).toEqual({
			bin: 'pnpm',
			args: ['exec', 'playwright', 'install', '--with-deps'],
		});
	});
});
