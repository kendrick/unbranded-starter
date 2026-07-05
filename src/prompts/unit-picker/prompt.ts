import type { Key } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import type { Unit, UnitId } from '../../manifest/types';
import type { PickerTheme } from './render';
import type { PickerEvent, PickerState } from './state';
import { styleText } from 'node:util';
import { isCancel, Prompt, settings } from '@clack/core';
import { renderUnitPicker } from './render';
import { createPickerState, reducePicker } from './state';

// What a keypress means to the picker. Kept as data (not a direct state mutation) so
// the whole translation table is pure and unit-testable without a terminal.
export type PickerIntent
	= | { kind: 'event'; event: PickerEvent }
		| { kind: 'submit' }
		| { kind: 'escape' }
		| { kind: 'ignore' };

// The base emits 'key' with the char argument lowercased, so a printable filter char
// is read from key.sequence instead. Left/right always translate to cycleFlavor — the
// reducer no-ops on rows without options, so there's no need to check here. Space is a
// toggle, never a filter char (labels rarely need a literal space to match).
export function translateKey(_char: string | undefined, key: Pick<Key, 'name' | 'sequence'>): PickerIntent {
	switch (key.name) {
		case 'up': return { kind: 'event', event: { type: 'move', delta: -1 } };
		case 'down': return { kind: 'event', event: { type: 'move', delta: 1 } };
		case 'left': return { kind: 'event', event: { type: 'cycleFlavor', delta: -1 } };
		case 'right': return { kind: 'event', event: { type: 'cycleFlavor', delta: 1 } };
		case 'space': return { kind: 'event', event: { type: 'toggle' } };
		case 'tab': return { kind: 'event', event: { type: 'toggleExpand' } };
		case 'backspace': return { kind: 'event', event: { type: 'backspace' } };
		case 'return':
		case 'enter': return { kind: 'submit' };
		case 'escape': return { kind: 'escape' };
	}

	const seq = key.sequence;
	if (seq !== undefined && seq.length === 1 && seq >= ' ' && seq !== '\x7F')
		return { kind: 'event', event: { type: 'char', char: seq } };
	return { kind: 'ignore' };
}

const THEME: PickerTheme = {
	dim: s => styleText('dim', s),
	active: s => styleText('cyan', s),
	selected: s => styleText('green', s),
	pointer: '❯',
	boxOn: '◼',
	boxOff: '◻',
	boxAuto: '◇',
	symbol: '◆',
};

// Rows of frame chrome (message line + summary + hint footer) subtracted from the
// terminal height so the windowed body leaves room for them.
const CHROME_ROWS = 6;

export interface UnitPickerOptions {
	message: string;
	units: Unit[];
	installed: Set<UnitId>;
	initialFlavors?: Record<string, string>;
	input?: Readable;
	output?: Writable;
	signal?: AbortSignal;
}

class UnitPickerPrompt extends Prompt<UnitId[]> {
	// Public so unitPicker() can read the chosen flavors after submit. Named `picker`,
	// not `state` — the base owns `state` (its ClackState).
	picker: PickerState;
	private readonly message: string;

	constructor(opts: UnitPickerOptions) {
		super({
			render() {
				return (this as unknown as UnitPickerPrompt).frame();
			},
			input: opts.input,
			output: opts.output,
			signal: opts.signal,
		}, false);

		this.message = opts.message;
		this.picker = createPickerState(opts.units, opts.installed, opts.initialFlavors ?? {});
		this._setValue([...this.picker.selected]);
		this.on('key', (char, key) => this.onKey(char, key));
	}

	private onKey(char: string | undefined, key: Key): void {
		const intent = translateKey(char, key);
		// Enter is left to the base's own submit path; nothing to do here.
		if (intent.kind === 'submit' || intent.kind === 'ignore')
			return;

		if (intent.kind === 'escape') {
			// Escape clears a live filter first; only an already-empty filter cancels.
			// The alias delete in unitPicker() is what lets this keypress reach here
			// instead of the base treating escape as an unconditional cancel.
			if (this.picker.filter)
				this.picker = reducePicker(this.picker, { type: 'clearFilter' });
			else
				this.state = 'cancel';
		}
		else {
			this.picker = reducePicker(this.picker, intent.event);
		}

		this._setValue([...this.picker.selected]);
	}

	private frame(): string {
		const out = this.output as Partial<{ columns: number; rows: number }>;
		return renderUnitPicker(this.picker, {
			message: this.message,
			width: out.columns ?? 80,
			maxRows: Math.max(5, (out.rows ?? 20) - CHROME_ROWS),
			promptState: this.state,
			theme: THEME,
		});
	}
}

export interface UnitPickerResult {
	ids: UnitId[];
	flavors: Record<string, string>;
}

// Drives the prompt and hands back both the picked ids and the chosen flavors, or the
// clack cancel symbol. The escape-alias hack is isolated here: escape is a global
// cancel alias, so it's removed from the live settings singleton for the duration and
// restored in finally. Ctrl+C keeps its own alias and still cancels unconditionally.
export async function unitPicker(opts: UnitPickerOptions): Promise<UnitPickerResult | symbol> {
	const priorEscape = settings.aliases.get('escape');
	settings.aliases.delete('escape');

	const prompt = new UnitPickerPrompt(opts);
	try {
		const result = await prompt.prompt();
		if (isCancel(result))
			return result;
		return { ids: result as UnitId[], flavors: prompt.picker.flavors };
	}
	finally {
		if (priorEscape !== undefined)
			settings.aliases.set('escape', priorEscape);
	}
}
