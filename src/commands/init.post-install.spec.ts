import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { confirm } from '@clack/prompts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runPostInstalls } from '../install/post';
import { writeAndInstall } from '../install/run';
import { unitPicker } from '../prompts/unit-picker/prompt';
import { runInit } from './init';

// Same TTY and install seams as init.spec.ts, plus runPostInstalls, so the test
// reads the answer runInit hands it instead of driving real hooks. It lives in
// its own file because init.spec.ts relies on the real runPostInstalls.
vi.mock('../prompts/unit-picker/prompt', () => ({ unitPicker: vi.fn() }));
vi.mock('@clack/prompts', async (importOriginal) => {
	const mod = await importOriginal<typeof import('@clack/prompts')>();
	return { ...mod, select: vi.fn(async () => ''), confirm: vi.fn() };
});
vi.mock('../install/run', async (importOriginal) => {
	const mod = await importOriginal<typeof import('../install/run')>();
	return { ...mod, writeAndInstall: vi.fn() };
});
vi.mock('../install/post', async (importOriginal) => {
	const mod = await importOriginal<typeof import('../install/post')>();
	return { ...mod, runPostInstalls: vi.fn() };
});

describe('--post-install without a recipe or --units (#105)', () => {
	let tmp: string;

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-post-install-'));
		writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'x', version: '0.0.0' }));
		vi.mocked(unitPicker).mockResolvedValue({ ids: ['opt-playwright'], flavors: {} });
		vi.mocked(confirm).mockResolvedValue(true);
		vi.mocked(writeAndInstall).mockResolvedValue({
			wrote: true,
			installed: true,
			cancelled: false,
			failed: false,
			computedWrites: [],
		});
		vi.mocked(runPostInstalls).mockResolvedValue({
			ran: [],
			skipped: [],
			failed: [],
			cancelled: false,
		});
	});

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
		vi.mocked(unitPicker).mockReset();
		vi.mocked(runPostInstalls).mockReset();
	});

	it.each(['none', 'all'] as const)(
		'passes --post-install %s through as the auto answer',
		async (value) => {
			await runInit({ targetDir: tmp, inline: { pm: 'pnpm', postInstall: value } });

			expect(vi.mocked(runPostInstalls)).toHaveBeenCalledOnce();
			expect(vi.mocked(runPostInstalls).mock.calls[0]?.[0]?.auto).toBe(value);
		},
	);

	it('rejects a value other than all or none before prompting', async () => {
		await expect(
			runInit({ targetDir: tmp, inline: { pm: 'pnpm', postInstall: 'some' } }),
		).rejects.toThrow('`--post-install` must be "all" or "none".');
		expect(vi.mocked(unitPicker)).not.toHaveBeenCalled();
	});
});
