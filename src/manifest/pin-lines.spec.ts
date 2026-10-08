import type { AnyUnit, PinLine } from './types';
import { describe, expect, it } from 'vitest';
import { applyLatest, applyPinLines } from './pin-lines';

const ts: AnyUnit = { id: 'core-typescript', category: 'types', label: '', description: '', files: [], devDependencies: { 'typescript': '7.0.2', '@types/node': '22.19.19' } };
const LINES: PinLine[] = [{ unit: 'core-typescript', when: 'core-eslint', devDependencies: { typescript: '6.0.3' } }];

describe('applyPinLines', () => {
	it('swaps in the line whose trigger unit resolved, and leaves the other pins alone', () => {
		const out = applyPinLines(ts, new Set(['core-typescript', 'core-eslint']), LINES);
		expect(out.devDependencies).toEqual({ 'typescript': '6.0.3', '@types/node': '22.19.19' });
	});

	it('keeps the default line when the trigger unit is absent, including with no lint unit at all', () => {
		expect(applyPinLines(ts, new Set(['core-typescript']), LINES)).toBe(ts);
		expect(applyPinLines(ts, new Set(['core-typescript', 'core-oxlint']), LINES)).toBe(ts);
	});

	it('never touches a unit no line names', () => {
		const other: AnyUnit = { ...ts, id: 'core-vitest' };
		expect(applyPinLines(other, new Set(['core-eslint']), LINES)).toBe(other);
	});
});

describe('applyLatest', () => {
	const held: AnyUnit = { ...ts, devDependencies: { 'typescript': '6.0.3', '@types/node': '22.19.19' } };

	it('writes a held pin as a caret on its major and everything else as latest', () => {
		expect(applyLatest(held, new Set(['core-typescript', 'core-eslint']), LINES).devDependencies).toEqual({ 'typescript': '^6', '@types/node': 'latest' });
	});

	it('writes latest for the same pin when its line is not active', () => {
		expect(applyLatest(held, new Set(['core-typescript']), LINES).devDependencies?.typescript).toBe('latest');
		expect(applyLatest(held, new Set(['core-typescript', 'core-oxlint']), LINES).devDependencies?.typescript).toBe('latest');
	});

	it('holds only the unit the line names', () => {
		const other: AnyUnit = { ...held, id: 'core-vitest' };
		expect(applyLatest(other, new Set(['core-eslint']), LINES).devDependencies?.typescript).toBe('latest');
	});

	it('rewrites dependencies too, never holds them, and leaves an absent map absent', () => {
		const withDeps: AnyUnit = { ...held, dependencies: { clsx: '2.1.1', typescript: '6.0.3' } };
		expect(applyLatest(withDeps, new Set(['core-eslint']), LINES).dependencies).toEqual({ clsx: 'latest', typescript: 'latest' });
		expect(applyLatest(held, new Set(['core-eslint']), LINES).dependencies).toBeUndefined();
	});
});
