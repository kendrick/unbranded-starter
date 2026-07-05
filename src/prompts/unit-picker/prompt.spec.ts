// @vitest-environment node
import type { Unit, UnitId } from '../../manifest/types';
import { PassThrough } from 'node:stream';
import { settings } from '@clack/core';
import { isCancel } from '@clack/prompts';
import { afterEach, describe, expect, it } from 'vitest';
import { translateKey, unitPicker } from './prompt';

function unit(id: UnitId, extras: Partial<Unit> = {}): Unit {
	return { id, category: 'lint', label: id, description: '', files: [], ...extras };
}

const UNITS: Unit[] = [
	unit('core-tailwind', { category: 'style', label: 'Tailwind v4' }),
	unit('core-vitest', { category: 'test', label: 'Vitest' }),
];

describe('translateKey', () => {
	it('maps navigation, selection, and control keys to picker events', () => {
		expect(translateKey(undefined, { name: 'up', sequence: '\x1B[A' })).toEqual({ kind: 'event', event: { type: 'move', delta: -1 } });
		expect(translateKey(undefined, { name: 'down', sequence: '\x1B[B' })).toEqual({ kind: 'event', event: { type: 'move', delta: 1 } });
		expect(translateKey(undefined, { name: 'left', sequence: '\x1B[D' })).toEqual({ kind: 'event', event: { type: 'cycleFlavor', delta: -1 } });
		expect(translateKey(undefined, { name: 'right', sequence: '\x1B[C' })).toEqual({ kind: 'event', event: { type: 'cycleFlavor', delta: 1 } });
		expect(translateKey(' ', { name: 'space', sequence: ' ' })).toEqual({ kind: 'event', event: { type: 'toggle' } });
		expect(translateKey(undefined, { name: 'tab', sequence: '\t' })).toEqual({ kind: 'event', event: { type: 'toggleExpand' } });
		expect(translateKey(undefined, { name: 'backspace', sequence: '\x7F' })).toEqual({ kind: 'event', event: { type: 'backspace' } });
		expect(translateKey(undefined, { name: 'return', sequence: '\r' })).toEqual({ kind: 'submit' });
		expect(translateKey(undefined, { name: 'escape', sequence: '\x1B' })).toEqual({ kind: 'escape' });
	});

	it('treats a printable key as a filter char using the raw sequence, not the lowercased char', () => {
		// The base lowercases the char param; the real key is in sequence. A filter of
		// "T" must stay uppercase so the picker matches case-insensitively on the truth.
		expect(translateKey('t', { name: undefined, sequence: 'T' })).toEqual({ kind: 'event', event: { type: 'char', char: 'T' } });
		expect(translateKey('a', { name: 'a', sequence: 'a' })).toEqual({ kind: 'event', event: { type: 'char', char: 'a' } });
	});

	it('ignores control sequences that are neither a mapped key nor a printable char', () => {
		expect(translateKey(undefined, { name: 'f5', sequence: '\x1B[15~' })).toEqual({ kind: 'ignore' });
	});
});

describe('unitPicker (stream-driven)', () => {
	afterEach(() => {
		// The escape-alias hack mutates a global singleton; every path must restore it.
		expect(settings.aliases.get('escape')).toBe('cancel');
	});

	function drive(keys: string): { input: PassThrough; output: PassThrough } {
		const input = new PassThrough();
		const output = new PassThrough();
		// Feed keystrokes once the readline interface is listening.
		queueMicrotask(() => input.write(keys));
		return { input, output };
	}

	it('filters, toggles, and submits the highlighted unit', async () => {
		const { input, output } = drive('tail \r'); // filter "tail", space toggles, enter submits
		const result = await unitPicker({ message: 'Pick', units: UNITS, installed: new Set(), input, output });
		expect(isCancel(result)).toBe(false);
		if (isCancel(result))
			return;
		expect(result.ids).toEqual(['core-tailwind']);
	});

	it('restores the escape alias after a submit', async () => {
		const { input, output } = drive('\r');
		await unitPicker({ message: 'Pick', units: UNITS, installed: new Set(), input, output });
		// The afterEach assertion is the real check; this awaits the resolution.
		expect(settings.aliases.get('escape')).toBe('cancel');
	});
});
