import type { PickerOption } from './options';
import type { PickerRow, PickerState } from './state';
import { filteredOptions, pickerRows, pickerSummary } from './state';

// Colors and glyphs, fully injected so the renderer stays pure and specs can pass a
// tag fake for ANSI-free snapshots. In production this is wired from @clack/prompts'
// S_* symbols and node:util styleText.
export interface PickerTheme {
	dim: (s: string) => string;
	active: (s: string) => string;
	selected: (s: string) => string;
	pointer: string;
	boxOn: string;
	boxOff: string;
	boxAuto: string;
	symbol: string;
}

export interface PickerView {
	message: string;
	width: number;
	maxRows: number;
	promptState: 'initial' | 'active' | 'error' | 'submit' | 'cancel';
	theme: PickerTheme;
}

interface Span {
	text: string;
	style?: (s: string) => string;
}

// Width-truncate each span's plain text, THEN style it. This is the one rule that
// keeps truncation from ever slicing through an ANSI escape: styling is applied last,
// to already-fitted text, so a cut can only land on visible characters.
function renderLine(spans: Span[], width: number): string {
	let remaining = width;
	let out = '';
	for (const span of spans) {
		if (remaining <= 0)
			break;
		const text = span.text.length > remaining ? `${span.text.slice(0, Math.max(0, remaining - 1))}…` : span.text;
		remaining -= text.length;
		out += span.style ? span.style(text) : text;
	}
	return out;
}

function fit(text: string, width: number): string {
	return text.length > width ? `${text.slice(0, Math.max(0, width - 1))}…` : text;
}

function optionSpans(row: Extract<PickerRow, { kind: 'option' }>, theme: PickerTheme, labelById: Map<string, string>): Span[] {
	const { option, selected, auto, active, flavor, requiredBy } = row;
	// Selected wins the box glyph over auto; the two are mutually exclusive anyway
	// (the resolver never marks a seed unit auto), but order the checks defensively.
	const box = selected ? theme.boxOn : auto ? theme.boxAuto : theme.boxOff;
	const boxStyle = selected ? theme.selected : auto ? theme.dim : undefined;
	const labelStyle = auto ? theme.dim : active ? theme.active : undefined;

	const spans: Span[] = [
		{ text: `${active ? theme.pointer : ' '} ` },
		{ text: `${box} `, style: boxStyle },
		{ text: option.label, style: labelStyle },
	];
	// Everything after the label is secondary, so it's dim and only shown when earned.
	if (flavor)
		spans.push({ text: ` · ${flavor} ▸`, style: theme.dim });
	if (option.installed)
		spans.push({ text: ' installed', style: theme.dim });
	if (auto) {
		const who = requiredBy ? labelById.get(requiredBy) : undefined;
		spans.push({ text: ` auto${who ? ` — required by ${who}` : ''}`, style: theme.dim });
	}
	// The hint only rides the active row, so the list stays one glanceable line per unit.
	if (active && option.hint)
		spans.push({ text: `  ${option.hint}`, style: theme.dim });
	return spans;
}

function detailLines(option: PickerOption, theme: PickerTheme, width: number): string[] {
	const d = option.detail;
	const parts: string[] = [];
	if (d.optionNote)
		parts.push(d.optionNote);
	if (d.files.length)
		parts.push(`files: ${d.files.map(f => f.dest).join(', ')}`);
	const deps = [...Object.keys(d.dependencies), ...Object.keys(d.devDependencies)];
	if (deps.length)
		parts.push(`deps: ${deps.join(', ')}`);
	if (d.implies.length)
		parts.push(`implies: ${d.implies.join(', ')}`);
	if (d.postInstall.length)
		parts.push(`post-install: ${d.postInstall.join('; ')}`);
	if (parts.length === 0)
		parts.push('no files or dependencies of its own');
	return parts.map(p => theme.dim(fit(`      ${p}`, width)));
}

function renderRow(row: PickerRow, view: PickerView, labelById: Map<string, string>): string[] {
	const { theme, width } = view;
	if (row.kind === 'header')
		return [renderLine([{ text: row.group }, { text: ` ${row.selected}/${row.total}`, style: theme.dim }], width)];
	if (row.kind === 'option')
		return [renderLine(optionSpans(row, theme, labelById), width)];
	return detailLines(row.option, theme, width);
}

// Keep the active row on screen when the list is taller than maxRows. Grows a window
// outward from the active row (preferring downward on ties) until the line budget is
// spent, then flags clipped edges with a dim ellipsis. Reserving two lines for the
// ellipses keeps the frame height stable whether or not an edge is actually clipped.
function windowBody(rows: PickerRow[], view: PickerView, labelById: Map<string, string>): string[] {
	const { maxRows, theme } = view;
	const groups = rows.map(row => renderRow(row, view, labelById));
	const lineCount = groups.reduce((n, g) => n + g.length, 0);
	if (lineCount <= maxRows)
		return groups.flat();

	const activeIdx = Math.max(0, rows.findIndex(r => r.kind === 'option' && r.active));
	const budget = Math.max(1, maxRows - 2);
	let start = activeIdx;
	let end = activeIdx;
	let used = groups[activeIdx]?.length ?? 0;

	while (true) {
		const up = start > 0 ? (groups[start - 1]?.length ?? 0) : Infinity;
		const down = end < rows.length - 1 ? (groups[end + 1]?.length ?? 0) : Infinity;
		if (up === Infinity && down === Infinity)
			break;
		if (down <= up) {
			if (used + down > budget)
				break;
			end++;
			used += down;
		}
		else {
			if (used + up > budget)
				break;
			start--;
			used += up;
		}
	}

	const out: string[] = [];
	if (start > 0)
		out.push(theme.dim('  …'));
	out.push(...groups.slice(start, end + 1).flat());
	if (end < rows.length - 1)
		out.push(theme.dim('  …'));
	return out;
}

// Persistent hints stay short; the flavor hint appears only when the active row has a
// variant axis, and esc-to-clear only while a filter is active. That contextual footer
// is what lets the picker teach ←→ without cluttering rows that can't use it.
function hints(state: PickerState): string[] {
	const active = filteredOptions(state)[state.cursor];
	const parts = ['↑↓ move', 'space select', 'tab details'];
	if (active?.options?.length)
		parts.push('←→ flavor');
	parts.push(state.filter ? 'esc clear' : 'type to filter');
	parts.push('↵ done');
	return parts;
}

export function renderUnitPicker(state: PickerState, view: PickerView): string {
	const { theme, width, message, promptState } = view;

	// Submit/cancel collapse to clack's compact one-liner rather than leaving the whole
	// list on screen after the prompt resolves.
	if (promptState === 'submit' || promptState === 'cancel') {
		if (promptState === 'cancel')
			return `${theme.symbol} ${message} ${theme.dim('(cancelled)')}`;
		const chosen = state.options.filter(o => state.selected.has(o.value)).map(o => o.label);
		return `${theme.symbol} ${message} ${theme.dim(chosen.length ? chosen.join(', ') : 'nothing selected')}`;
	}

	const labelById = new Map(state.options.map(o => [o.value as string, o.label]));
	const lines: string[] = [`${theme.symbol} ${message}`];

	if (state.filter)
		lines.push(theme.dim(fit(`  filter: ${state.filter}`, width)));

	if (filteredOptions(state).length === 0)
		lines.push(theme.dim(fit(`  no matches for "${state.filter}"`, width)));
	else
		lines.push(...windowBody(pickerRows(state), view, labelById));

	const summary = pickerSummary(state);
	if (summary.units > 0)
		lines.push(theme.dim(fit(`  ${summary.units} units · ${summary.files} files · ${summary.deps} deps`, width)));

	lines.push(theme.dim(fit(`  ${hints(state).join(' · ')}`, width)));

	return lines.join('\n');
}
