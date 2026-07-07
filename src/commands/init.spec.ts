import type { Unit, UnitId } from '../manifest/types';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { writeAndInstall } from '../install/run';
import { unitPicker } from '../prompts/unit-picker/prompt';
import { formatPlan, runInit } from './init';

// The picker is the one TTY boundary in the interactive flow; mocking just it lets
// runInit's threading be exercised against a real temp dir and the real detectors.
vi.mock('../prompts/unit-picker/prompt', () => ({ unitPicker: vi.fn() }));

// The start-from-a-preset select now runs ahead of the picker; answering
// "start empty" keeps these tests on the flow they've always exercised.
vi.mock('@clack/prompts', async (importOriginal) => {
	const mod = await importOriginal<typeof import('@clack/prompts')>();
	return { ...mod, select: vi.fn(async () => '') };
});

// The install spawn is the other boundary (same seam run.spec mocks): stubbing it
// per-test lets the error path run without a package manager in the loop.
vi.mock('../install/run', () => ({ writeAndInstall: vi.fn() }));

// Minimal fixture builder — formatPlan only reads id/label/files/deps.
function unit(id: UnitId, label: string, extras: Partial<Unit> = {}): Unit {
	return {
		id,
		category: 'lint',
		label,
		description: '',
		files: [],
		...extras,
	};
}

describe('runInit preselect', () => {
	let tmp: string;

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
		vi.mocked(unitPicker).mockReset();
	});

	it('seeds the picker from a chosen preset, flavor included', async () => {
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-init-preset-'));
		writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'x', version: '0.0.0' }));
		const { select } = await import('@clack/prompts');
		vi.mocked(select).mockResolvedValueOnce('next-app');
		vi.mocked(unitPicker).mockResolvedValue({ ids: [], flavors: {} });

		await runInit({ targetDir: tmp, dryRun: true, inline: { pm: 'pnpm' } });

		const picker = vi.mocked(unitPicker).mock.calls[0]?.[0];
		expect(picker?.initialSelected).toContain('opt-shadcn');
		expect(picker?.initialSelected).toContain('core-eslint');
		// The preset's recorded flavor beats the environment sniff.
		expect(picker?.initialFlavors?.eslintFlavor).toBe('next');
	});

	it('opens the picker with the preselected units checked', async () => {
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-init-preselect-'));
		// A package.json puts detectTarget in augment mode (no project-name prompt);
		// inline --pm skips PM detection. The picker mock is then the only prompt.
		writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'x', version: '0.0.0' }));
		vi.mocked(unitPicker).mockResolvedValue({ ids: ['core-editorconfig'], flavors: {} });

		await runInit({ targetDir: tmp, dryRun: true, preselect: ['core-editorconfig'], inline: { pm: 'pnpm' } });

		expect(vi.mocked(unitPicker).mock.calls[0]?.[0]?.initialSelected).toEqual(['core-editorconfig']);
	});
});

describe('runInit result', () => {
	let tmp: string;

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
		vi.mocked(unitPicker).mockReset();
		vi.mocked(writeAndInstall).mockReset();
	});

	it('reports ok from a completed dry run', async () => {
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-init-result-'));
		writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'x', version: '0.0.0' }));
		vi.mocked(unitPicker).mockResolvedValue({ ids: ['core-editorconfig'], flavors: {} });

		const result = await runInit({ targetDir: tmp, dryRun: true, inline: { pm: 'pnpm' } });

		expect(result).toEqual({ ok: true });
	});

	it('reports not-ok when the install step errors', async () => {
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-init-result-'));
		writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'x', version: '0.0.0' }));
		vi.mocked(writeAndInstall).mockResolvedValue({ wrote: true, installed: false, cancelled: false, error: 'install exploded', computedWrites: [] });

		// doctor --fix keys its exit code off this flag, so a swallowed install
		// error would report a repaired repo that isn't.
		const result = await runInit({ targetDir: tmp, inline: { units: 'core-editorconfig', pm: 'pnpm', yes: true } });

		expect(result).toEqual({ ok: false });
	});
});

describe('formatPlan', () => {
	const eslint = unit('core-eslint', 'ESLint');
	const typescript = unit('core-typescript', 'TypeScript');

	it('names the requirer of an auto-added unit', () => {
		// The provenance line is #30's whole point: a user who only picked ESLint
		// should see *why* TypeScript joined the plan.
		const out = formatPlan(
			[eslint, typescript],
			['core-typescript'],
			{ 'core-typescript': 'core-eslint' },
			'pnpm',
			false,
		);
		expect(out).toContain('• TypeScript (auto — required by ESLint)');
	});

	it('leaves an explicitly-picked unit unannotated', () => {
		const out = formatPlan([eslint, typescript], [], {}, 'pnpm', false);
		expect(out).toContain('• ESLint');
		expect(out).not.toContain('ESLint (auto');
		expect(out).not.toContain('TypeScript (auto');
	});

	it('falls back to a bare (auto) when provenance is somehow missing', () => {
		// Defensive: auto and requiredBy come from the same resolver call, so a gap
		// shouldn't happen — but a bare "(auto)" beats printing "required by undefined".
		const out = formatPlan([eslint, typescript], ['core-typescript'], {}, 'pnpm', false);
		expect(out).toContain('• TypeScript (auto)');
		expect(out).not.toContain('required by');
	});
});
