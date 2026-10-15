import type { AnyUnit, OptionCoupling, UnitOption } from './types';
import { describe, expect, it } from 'vitest';
import {
	allowedValues,
	applyLatest,
	constrain,
	findCouplingViolation,
	heldPins,
	inferLineChoice,
	legacyTsFlavor,
	lineDefault,
	majorOf,
	resolveLine,
	specsToWrite,
} from './option-lines';

// Synthetic option and couplings rather than UNITS, so the rules are tested apart
// from whatever the manifest pins today.
const line: UnitOption = {
	key: 'typescriptLine',
	label: '',
	default: '7',
	choices: [
		{ value: '7', label: '', devDependencies: { typescript: '7.0.2' } },
		{ value: '6', label: '', devDependencies: { typescript: '6.0.3' } },
	],
};
const couplings: OptionCoupling[] = [
	{
		key: 'typescriptLine',
		when: 'core-eslint',
		allowed: ['6'],
		default: '6',
		reason: 'typescript-eslint',
	},
];
const decl = (spec?: string) => (name: string) => (name === 'typescript' ? spec : undefined);

describe('majorOf', () => {
	it.each([
		['6.0.3', 6],
		['^6.0.3', 6],
		['~7.0.2', 7],
		['^6', 6],
		['6', 6],
		['~6.0', 6],
		['6.x', 6],
		['6.X', 6],
		['6.*', 6],
		['6.0.x', 6],
		['=6.0.3', 6],
		['v6.0.3', 6],
		['>=6.0.0 <7', 6],
		['>=6.0.0 <7.0.0', 6],
		['>=6.0.0 <6.5', 6],
		['^6.0.3-rc.1', 6],
		[' ^6.0.3 ', 6],
		['latest', undefined],
		['*', undefined],
		['x', undefined],
		['', undefined],
		['<7', undefined],
		['>=6', undefined],
		['>=6.0.0', undefined],
		['<=6.9.9', undefined],
		['6 || 7', undefined],
		['^6.0.0 || ^7.0.0', undefined],
		['>=6.0.0 <8', undefined],
		['6.0.0 - 7.0.0', undefined],
		['6.0.0 - 6.9.9', 6],
		['6 - 6.5', 6],
		['6.0.0 - 7', undefined],
		['git+https://github.com/microsoft/TypeScript.git', undefined],
		['file:../typescript', undefined],
		['workspace:*', undefined],
		['workspace:^6.0.3', undefined],
		['npm:typescript@6.0.3', undefined],
		['github:microsoft/TypeScript#v6.0.3', undefined],
	])('%s → %s', (spec, major) => expect(majorOf(spec)).toBe(major));
});

describe('inferLineChoice', () => {
	it('picks the choice on the declared major', () => {
		expect(inferLineChoice(line, decl('^6.0.3'))).toBe('6');
		expect(inferLineChoice(line, decl('6.0.3'))).toBe('6');
		expect(inferLineChoice(line, decl('^6'))).toBe('6');
		expect(inferLineChoice(line, decl('^7.0.2'))).toBe('7');
	});
	it('returns undefined when no choice is on that major, or nothing is declared', () => {
		expect(inferLineChoice(line, decl('5.9.3'))).toBeUndefined();
		expect(inferLineChoice(line, decl('latest'))).toBeUndefined();
		expect(inferLineChoice(line, decl(undefined))).toBeUndefined();
	});
	it('ignores a package only one choice pins', () => {
		const lopsided: UnitOption = {
			...line,
			choices: [
				{ value: '7', label: '', devDependencies: { typescript: '7.0.2', extra: '6.0.0' } },
				{ value: '6', label: '', devDependencies: { typescript: '6.0.3' } },
			],
		};
		const only = (name: string) => (name === 'extra' ? '6.0.0' : undefined);
		expect(inferLineChoice(lopsided, only)).toBeUndefined();
	});
});

describe('lineDefault', () => {
	it('prefers a valid recorded value over the declared major', () => {
		expect(lineDefault(line, '7', decl('^6.0.3'))).toBe('7');
	});
	it('ignores an invalid recorded value', () => {
		expect(lineDefault(line, '5', decl('^6.0.3'))).toBe('6');
	});
	it('falls back to the option default', () => {
		expect(lineDefault(line, undefined, decl('5.9.3'))).toBe('7');
		expect(lineDefault(line, undefined, decl(undefined))).toBe('7');
	});
});

describe('resolveLine', () => {
	const eslint = new Set(['core-eslint']);
	const oxlint = new Set(['core-oxlint']);
	it('keeps an inferred line the coupling allows', () => {
		expect(resolveLine(line, undefined, decl('6.x'), oxlint, couplings)).toBe('6');
		expect(resolveLine(line, undefined, decl('>=6.0.0 <7'), oxlint, couplings)).toBe('6');
		expect(resolveLine(line, undefined, decl('^6.0.3'), eslint, couplings)).toBe('6');
	});
	it('bends a defaulted or recorded line the coupling forbids', () => {
		expect(resolveLine(line, undefined, decl(undefined), eslint, couplings)).toBe('6');
		expect(resolveLine(line, '7', decl(undefined), eslint, couplings)).toBe('6');
	});
	it('falls to the option default with nothing recorded or readable', () => {
		expect(resolveLine(line, undefined, decl('latest'), oxlint, couplings)).toBe('7');
	});
});

describe('couplings', () => {
	const eslint = new Set(['core-eslint']);
	const oxlint = new Set(['core-oxlint']);
	it('bends a value outside allowed to the coupling default only when `when` resolved', () => {
		expect(constrain('typescriptLine', '7', eslint, couplings)).toBe('6');
		expect(constrain('typescriptLine', '6', eslint, couplings)).toBe('6');
		expect(constrain('typescriptLine', '7', oxlint, couplings)).toBe('7');
		expect(constrain('typescriptLine', '6', oxlint, couplings)).toBe('6');
	});
	it('leaves an uncoupled key alone', () => {
		expect(constrain('oxlintFlavor', 'react', eslint, couplings)).toBe('react');
	});
	it('limits allowedValues beside `when`', () => {
		expect(allowedValues(line, eslint, couplings)).toEqual(['6']);
		expect(allowedValues(line, oxlint, couplings)).toEqual(['7', '6']);
	});
	it('reports a violation only for a value outside allowed beside `when`', () => {
		expect(findCouplingViolation({ typescriptLine: '7' }, eslint, couplings)).toEqual({
			key: 'typescriptLine',
			value: '7',
			when: 'core-eslint',
			reason: 'typescript-eslint',
		});
		expect(findCouplingViolation({ typescriptLine: '6' }, eslint, couplings)).toBeUndefined();
		expect(findCouplingViolation({ typescriptLine: '7' }, oxlint, couplings)).toBeUndefined();
		expect(findCouplingViolation({}, eslint, couplings)).toBeUndefined();
	});
	it('defaults to the manifest couplings, which keep core-eslint on TS 6', () => {
		expect(findCouplingViolation({ typescriptLine: '7' }, eslint)).toMatchObject({
			when: 'core-eslint',
		});
		expect(constrain('typescriptLine', '7', eslint)).toBe('6');
	});
});

describe('heldPins', () => {
	const unit: AnyUnit = {
		id: 'core-typescript',
		category: 'types',
		label: '',
		description: '',
		files: [],
		options: [line],
	};
	it('holds a non-default line choice to its major', () => {
		expect(heldPins([unit], { typescriptLine: '6' }, ['typescriptLine'])).toEqual(
			new Map([['typescript', '^6']]),
		);
	});
	it('holds nothing on the default choice, an unset option, or a non-line option', () => {
		expect(heldPins([unit], { typescriptLine: '7' }, ['typescriptLine']).size).toBe(0);
		expect(heldPins([unit], {}, ['typescriptLine']).size).toBe(0);
		expect(heldPins([unit], { typescriptLine: '6' }, []).size).toBe(0);
	});
});

describe('applyLatest', () => {
	const ts: AnyUnit = {
		id: 'core-typescript',
		category: 'types',
		label: '',
		description: '',
		files: [],
		devDependencies: { 'typescript': '6.0.3', '@types/node': '22.19.19' },
	};
	const held = new Map([['typescript', '^6']]);

	it('writes a held pin as a caret on its major and everything else as latest', () => {
		expect(applyLatest(ts, held).devDependencies).toEqual({
			'typescript': '^6',
			'@types/node': 'latest',
		});
	});

	it('writes latest for the same pin when nothing holds it', () => {
		expect(applyLatest(ts, new Map()).devDependencies?.typescript).toBe('latest');
	});

	it('rewrites dependencies too, never holds them, and leaves an absent map absent', () => {
		const withDeps: AnyUnit = { ...ts, dependencies: { clsx: '2.1.1', typescript: '6.0.3' } };
		expect(applyLatest(withDeps, held).dependencies).toEqual({
			clsx: 'latest',
			typescript: 'latest',
		});
		expect(applyLatest(ts, held).dependencies).toBeUndefined();
	});
});

describe('specsToWrite', () => {
	const ts: AnyUnit = {
		id: 'core-typescript',
		category: 'types',
		label: '',
		description: '',
		files: [],
		devDependencies: { typescript: '6.0.3' },
	};
	const held = new Map([['typescript', '^6']]);

	it("hands back the manifest's units untouched without --latest", () => {
		const units = [ts];
		expect(specsToWrite(units, held, false)).toBe(units);
	});

	it('runs every unit through applyLatest under --latest', () => {
		expect(specsToWrite([ts], held, true).map((u) => u.devDependencies)).toEqual([
			{ typescript: '^6' },
		]);
	});
});

describe('legacyTsFlavor', () => {
	it('is dom when core-typescript is tracked', () => {
		expect(legacyTsFlavor(new Set(['core-typescript', 'core-eslint']))).toBe('dom');
	});

	it('is undefined when core-typescript is not tracked', () => {
		expect(legacyTsFlavor(new Set(['core-eslint']))).toBeUndefined();
		expect(legacyTsFlavor(new Set())).toBeUndefined();
	});
});
