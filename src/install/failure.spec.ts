import { isCancel, select } from '@clack/prompts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { formatInstallFailure, formatKeepLine, promptInstallFailure, resolveInstallFailure } from './failure';

// `select` is the one TTY prompt this module drives, so it's the only export
// stubbed. `isCancel` is wrapped rather than replaced so it keeps checking the
// real cancel symbol by default—the one cancel test below overrides it for
// the case a mocked `select` can't produce that symbol on its own.
vi.mock('@clack/prompts', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@clack/prompts')>();
	return { ...actual, select: vi.fn(), isCancel: vi.fn(actual.isCancel) };
});

// No restoreMocks in this suite (matches run.spec.ts), so reset by hand
// between tests rather than let one test's stubbed return value leak.
beforeEach(() => {
	vi.mocked(select).mockReset();
	vi.mocked(isCancel).mockClear();
});

describe('formatInstallFailure', () => {
	it('attributes the failure to unbranded and names the command and exit code', () => {
		expect(formatInstallFailure('pnpm', 1)).toBe(
			'unbranded ran `pnpm install` and it failed with exit code 1.',
		);
	});

	it('reads correctly when exitCode is undefined', () => {
		expect(formatInstallFailure('npm', undefined)).toBe(
			'unbranded ran `npm install` and it failed before producing an exit code.',
		);
	});

	it('adds a clause naming a single added script and warning that every install runs it', () => {
		expect(formatInstallFailure('pnpm', 1, { prepare: 'husky' })).toBe(
			'unbranded ran `pnpm install` and it failed with exit code 1.'
			+ ' This run added the `prepare` script to `package.json`, and every `pnpm install` runs it.',
		);
	});

	it('lists multiple added scripts with an "and", plural noun and pronoun', () => {
		expect(formatInstallFailure('yarn', 2, { prepare: 'husky', postinstall: 'patch-package' })).toBe(
			'unbranded ran `yarn install` and it failed with exit code 2.'
			+ ' This run added the `prepare` and `postinstall` scripts to `package.json`, and every `yarn install` runs them.',
		);
	});

	it('omits the scripts clause entirely when addedScripts is empty', () => {
		expect(formatInstallFailure('bun', 1, {})).toBe(
			'unbranded ran `bun install` and it failed with exit code 1.',
		);
	});
});

describe('formatKeepLine', () => {
	it('tells the user to fix and re-run the install, or restore with git', () => {
		expect(formatKeepLine('pnpm', '/repo')).toBe(
			'The files this run wrote are still in `/repo`. Fix the install and run `pnpm install` there, or restore them with git.',
		);
	});
});

describe('promptInstallFailure', () => {
	it('returns "keep" when the user picks keep', async () => {
		vi.mocked(select).mockResolvedValueOnce('keep');
		await expect(promptInstallFailure()).resolves.toBe('keep');
	});

	it('returns "rollback" when the user picks roll back', async () => {
		vi.mocked(select).mockResolvedValueOnce('rollback');
		await expect(promptInstallFailure()).resolves.toBe('rollback');
	});

	it('returns "cancel" on isCancel, without calling process.exit', async () => {
		// Driving `select` to resolve the real clack cancel symbol means driving
		// an actual prompt; mocking `isCancel` true is the documented fallback
		// for exercising the cancel path without a TTY (see run.spec.ts).
		vi.mocked(isCancel).mockReturnValueOnce(true);
		const exit = vi.spyOn(process, 'exit').mockImplementation(() => {
			throw new Error('process.exit should not be called by promptInstallFailure');
		});
		try {
			await expect(promptInstallFailure()).resolves.toBe('cancel');
			expect(exit).not.toHaveBeenCalled();
		}
		finally {
			exit.mockRestore();
		}
	});
});

describe('resolveInstallFailure', () => {
	it('prompts when policy is undefined', async () => {
		vi.mocked(select).mockResolvedValueOnce('keep');
		await expect(resolveInstallFailure(undefined)).resolves.toBe('keep');
		expect(select).toHaveBeenCalledTimes(1);
	});

	it('returns "keep" as-is without prompting', async () => {
		await expect(resolveInstallFailure('keep')).resolves.toBe('keep');
		expect(select).not.toHaveBeenCalled();
	});

	it('returns "rollback" as-is without prompting', async () => {
		await expect(resolveInstallFailure('rollback')).resolves.toBe('rollback');
		expect(select).not.toHaveBeenCalled();
	});
});
