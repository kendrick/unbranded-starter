import type { Unit, UnitId } from '../manifest/types';
import { describe, expect, it } from 'vitest';
import { formatPlan } from './init';

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
