import type { Unit, UnitId } from '../manifest/types';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { writeAndInstall } from '../install/run';
import { unitPicker } from '../prompts/unit-picker/prompt';
import { STATE_FILENAME } from '../state/state';
import { formatPlan, runInit } from './init';

// The picker is the one TTY boundary in the interactive flow; mocking just it lets
// runInit's threading be exercised against a real temp dir and the real detectors.
vi.mock('../prompts/unit-picker/prompt', () => ({ unitPicker: vi.fn() }));

// The start-from-a-preset select now runs ahead of the picker; answering
// "start empty" keeps these tests on the flow they've always exercised.
// `confirm` is stubbed too so a full (non-dry-run, non---yes) interactive pass can
// answer "Apply?" without a real TTY—everything else stays real.
vi.mock('@clack/prompts', async (importOriginal) => {
	const mod = await importOriginal<typeof import('@clack/prompts')>();
	return { ...mod, select: vi.fn(async () => ''), confirm: vi.fn() };
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
		vi.mocked(writeAndInstall).mockResolvedValue({ wrote: true, installed: false, cancelled: false, failed: true, error: 'install exploded', computedWrites: [] });

		// doctor --fix keys its exit code off this flag, so a swallowed install
		// error would report a repaired repo that isn't.
		const result = await runInit({ targetDir: tmp, inline: { units: 'core-editorconfig', pm: 'pnpm', yes: true } });

		expect(result).toEqual({ ok: false });
	});
});

describe('runInit install-failure branching (#114)', () => {
	let tmp: string;

	afterEach(async () => {
		rmSync(tmp, { recursive: true, force: true });
		vi.mocked(unitPicker).mockReset();
		vi.mocked(writeAndInstall).mockReset();
		const { select, confirm } = await import('@clack/prompts');
		// mockClear only, not mockReset—the latter would wipe select's
		// module-mock default implementation (`async () => ''`) for every other
		// describe block in this file that relies on it.
		vi.mocked(select).mockClear();
		vi.mocked(confirm).mockReset();
	});

	it('rolls back without prompting on a non-interactive run', async () => {
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-init-install-failure-noninteractive-'));
		writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'x', version: '0.0.0' }));
		vi.mocked(writeAndInstall).mockResolvedValue({ wrote: true, installed: false, cancelled: false, failed: true, installExitCode: 2, computedWrites: [] });

		const result = await runInit({ targetDir: tmp, inline: { units: 'core-editorconfig', pm: 'npm', yes: true } });

		// Every non-interactive run resolves straight to rollback (nobody's
		// watching to answer a prompt), and rollback is the one branch that
		// deliberately skips the state-file write—see recordState's comment
		// in init.ts. Its absence here is what proves the prompt never fired.
		expect(result).toEqual({ ok: false });
		expect(existsSync(join(tmp, STATE_FILENAME))).toBe(false);
	});

	it('writes state when the interactive prompt answers "keep"', async () => {
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-init-install-failure-keep-'));
		writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'x', version: '0.0.0' }));
		vi.mocked(unitPicker).mockResolvedValue({ ids: ['core-editorconfig'], flavors: {} });
		vi.mocked(writeAndInstall).mockResolvedValue({ wrote: true, installed: false, cancelled: false, failed: true, installExitCode: 2, computedWrites: [] });

		const { select, confirm } = await import('@clack/prompts');
		// Two select() calls happen before a "keep" answer even means anything:
		// "Start from a preset?" (start empty), then the install-failure prompt
		// itself. The module mock already defaults select to '', but queuing
		// both explicitly keeps this test from depending on that default.
		vi.mocked(select).mockResolvedValueOnce('').mockResolvedValueOnce('keep');
		// inline.pm keeps pm detection out of the prompt sequence without
		// tripping nonInteractive, which is what keeps config===null and this
		// run on the interactive branch (same trick the onConflict tests below
		// use for "Apply?").
		vi.mocked(confirm).mockResolvedValueOnce(true);

		const result = await runInit({ targetDir: tmp, inline: { pm: 'npm' } });

		expect(result).toEqual({ ok: false });
		expect(existsSync(join(tmp, STATE_FILENAME))).toBe(true);
	});

	it('regression: a cancelled (not failed) install still writes state and reports ok', async () => {
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-init-install-cancelled-'));
		writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'x', version: '0.0.0' }));
		// cancelled:true, failed:false is a different thing entirely—an
		// install spawn interrupted mid-run, not a #114 failure—and it kept
		// its pre-#114 behavior on purpose: state written, ok:true.
		vi.mocked(writeAndInstall).mockResolvedValue({ wrote: true, installed: false, cancelled: true, failed: false, computedWrites: [] });

		const result = await runInit({ targetDir: tmp, inline: { units: 'core-editorconfig', pm: 'npm', yes: true } });

		expect(result).toEqual({ ok: true });
		expect(existsSync(join(tmp, STATE_FILENAME))).toBe(true);
	});
});

describe('runInit onConflict threading (#113)', () => {
	let tmp: string;

	afterEach(async () => {
		rmSync(tmp, { recursive: true, force: true });
		vi.mocked(unitPicker).mockReset();
		vi.mocked(writeAndInstall).mockReset();
		const { confirm } = await import('@clack/prompts');
		vi.mocked(confirm).mockReset();
	});

	it('passes onConflict "skip" through to writeAndInstall when the resolved config says skip', async () => {
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-init-onconflict-skip-'));
		writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'x', version: '0.0.0' }));
		vi.mocked(writeAndInstall).mockResolvedValue({ wrote: true, installed: true, cancelled: false, failed: false, computedWrites: [] });

		// --yes plus an explicit --units skips the picker and the Apply confirm
		// entirely, so config.onConflict comes straight from the inline flag.
		await runInit({ targetDir: tmp, inline: { units: 'core-editorconfig', pm: 'pnpm', onConflict: 'skip', yes: true } });

		expect(vi.mocked(writeAndInstall).mock.calls[0]?.[0]?.onConflict).toBe('skip');
	});

	it('passes onConflict undefined on an interactive run, which is what makes collisions prompt', async () => {
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-init-onconflict-interactive-'));
		writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'x', version: '0.0.0' }));
		vi.mocked(unitPicker).mockResolvedValue({ ids: ['core-editorconfig'], flavors: {} });
		vi.mocked(writeAndInstall).mockResolvedValue({ wrote: true, installed: true, cancelled: false, failed: false, computedWrites: [] });
		const { confirm } = await import('@clack/prompts');
		// Only "Apply?" fires here: inline.pm already set makes usedInlineFlags true,
		// so runInit skips its own "save this as a recipe?" confirm afterward.
		vi.mocked(confirm).mockResolvedValueOnce(true);

		await runInit({ targetDir: tmp, inline: { pm: 'pnpm' } });

		expect(vi.mocked(writeAndInstall).mock.calls[0]?.[0]?.onConflict).toBeUndefined();
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
