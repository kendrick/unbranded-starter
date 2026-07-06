import type { Unit, UnitId } from '../manifest/types';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { unitPicker } from '../prompts/unit-picker/prompt';
import { formatPlan, runInit } from './init';

// The picker is the one TTY boundary in the interactive flow; mocking just it lets
// runInit's threading be exercised against a real temp dir and the real detectors.
vi.mock('../prompts/unit-picker/prompt', () => ({ unitPicker: vi.fn() }));

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
