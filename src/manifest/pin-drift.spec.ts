import type { AnyUnit, PinLine } from './types';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PKG_ROOT } from '../util/paths';
import { PIN_LINES, UNITS } from './index';
import { findPinDrift } from './pin-drift';

// This repo scaffolds config it also runs on itself: every manifest pin names
// a devDependency version this repo's own tooling should be exercising. When
// the two drift by a major, the scaffolded projects are running code this repo
// never tests against, and the dogfooding claim goes silent. pnpm's strict
// node_modules layout means only direct dependencies resolve at the root, so
// a pin with no installed package here is simply not one of this repo's own
// devDependencies—not a drift.
function installedVersion(name: string): string | undefined {
	const p = join(PKG_ROOT, 'node_modules', name, 'package.json');
	return existsSync(p)
		? (JSON.parse(readFileSync(p, 'utf-8')) as { version?: string }).version
		: undefined;
}

const tsUnit: AnyUnit = {
	id: 'core-typescript',
	category: 'types',
	label: '',
	description: '',
	files: [],
	devDependencies: { typescript: '7.0.2' },
};
const tsLines: PinLine[] = [
	{ unit: 'core-typescript', when: 'core-eslint', devDependencies: { typescript: '6.0.3' } },
];

describe("manifest pins match this repo's own installed majors", () => {
	it('every exact manifest pin resolves to the same major as node_modules, on some line', () => {
		expect(findPinDrift(UNITS, PIN_LINES, installedVersion)).toEqual([]);
	});

	it('accepts a package whose installed major matches either of its lines', () => {
		expect(findPinDrift([tsUnit], tsLines, () => '6.0.3')).toEqual([]);
		expect(findPinDrift([tsUnit], tsLines, () => '7.0.2')).toEqual([]);
	});

	it('reports a package whose installed major matches neither line', () => {
		expect(findPinDrift([tsUnit], tsLines, () => '5.9.3')).toEqual([
			'typescript: manifest pins 7.0.2 or 6.0.3, node_modules has 5.9.3',
		]);
	});

	it("reports the real manifest's typescript when the install matches neither of its lines", () => {
		// Against UNITS/PIN_LINES, not the fixture, so a line dropped or re-pinned in the
		// manifest shows up here instead of passing silently.
		expect(
			findPinDrift(UNITS, PIN_LINES, (name) => (name === 'typescript' ? '5.9.3' : undefined)),
		).toEqual(['typescript: manifest pins 7.0.2 or 6.0.3, node_modules has 5.9.3']);
	});

	it("skips ranges and packages this repo doesn't install", () => {
		const unit: AnyUnit = {
			id: 'x',
			category: 'types',
			label: '',
			description: '',
			files: [],
			devDependencies: { a: '^1.0.0', b: '2.0.0' },
		};
		expect(findPinDrift([unit], [], (name) => (name === 'a' ? '9.0.0' : undefined))).toEqual([]);
	});

	it('checks dependencies and option-choice pins, not only devDependencies', () => {
		const unit: AnyUnit = {
			id: 'x',
			category: 'types',
			label: '',
			description: '',
			files: [],
			dependencies: { d: '1.0.0' },
			options: [
				{
					key: 'k',
					label: '',
					default: 'c',
					choices: [{ value: 'c', label: '', devDependencies: { e: '2.0.0' } }],
				},
			],
		};
		expect(findPinDrift([unit], [], () => '9.0.0')).toEqual([
			'd: manifest pins 1.0.0, node_modules has 9.0.0',
			'e: manifest pins 2.0.0, node_modules has 9.0.0',
		]);
	});
});
