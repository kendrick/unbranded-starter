import type { Unit, UnitId } from '../manifest/types';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { detectInstalledUnits } from '../detect/installed';
import { buildPickerOptions, formatPlan } from './init';

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

describe('buildPickerOptions', () => {
	let tmp: string;
	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-picker-'));
	});
	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	// A visible tag stand-in for styleText('dim') so snapshots stay ANSI-free and
	// stable — real ANSI codes vary with NO_COLOR and whether stdout is a TTY.
	const dim = (s: string): string => `<dim>${s}</dim>`;

	const fixtureUnits: Unit[] = [
		unit('core-eslint', 'ESLint', { category: 'lint', description: 'Lint JS and TS.' }),
		unit('core-tailwind', 'Tailwind v4', { category: 'style', description: 'Utility CSS.' }),
		unit('core-vitest', 'Vitest', { category: 'test', description: 'Unit tests.' }),
	];

	it('badges exactly the units the detector found, grouped by category', () => {
		// eslint.config.mjs → core-eslint; tailwindcss dep → core-tailwind; vitest neither.
		writeFileSync(join(tmp, 'eslint.config.mjs'), '');
		writeFileSync(join(tmp, 'package.json'), JSON.stringify({ devDependencies: { tailwindcss: '4.3.0' } }));

		const installed = detectInstalledUnits({ cwd: tmp, units: fixtureUnits });
		const options = buildPickerOptions(fixtureUnits, installed, dim);

		expect(options).toMatchInlineSnapshot(`
			{
			  "Linting": [
			    {
			      "hint": "Lint JS and TS.",
			      "label": "ESLint <dim>installed</dim>",
			      "value": "core-eslint",
			    },
			  ],
			  "Styles": [
			    {
			      "hint": "Utility CSS.",
			      "label": "Tailwind v4 <dim>installed</dim>",
			      "value": "core-tailwind",
			    },
			  ],
			  "Testing": [
			    {
			      "hint": "Unit tests.",
			      "label": "Vitest",
			      "value": "core-vitest",
			    },
			  ],
			}
		`);
	});

	it('never disables an installed option, so it stays re-applicable', () => {
		const options = buildPickerOptions(fixtureUnits, new Set<UnitId>(['core-eslint']), dim);
		const all = Object.values(options).flat();

		expect(all.every(o => !('disabled' in o))).toBe(true);
		// The badge rides in the label; the value stays the bare id so selection works.
		const eslint = all.find(o => o.value === 'core-eslint');
		expect(eslint?.label).toContain('<dim>installed</dim>');
		expect(eslint?.value).toBe('core-eslint');
	});
});
