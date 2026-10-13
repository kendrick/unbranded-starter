import type { AnyUnit, OptionCoupling, UnitOption } from './types';
import { LINE_OPTIONS, OPTION_COUPLINGS } from './index';

// '^6' is what --latest writes for a held line, so a bare major counts too.
export function majorOf(spec: string): number | undefined {
	const m = /^[\^~]?(\d+)(?:\.\d+){0,2}$/.exec(spec)?.[1];
	return m === undefined ? undefined : Number(m);
}

// Only a package every choice pins can identify a line; a package one choice
// alone adds says nothing about which line the project is on.
export function inferLineChoice(
	option: UnitOption,
	declared: (name: string) => string | undefined,
): string | undefined {
	const first = option.choices[0]?.devDependencies ?? {};
	const shared = Object.keys(first).filter((n) =>
		option.choices.every((c) => c.devDependencies?.[n] !== undefined),
	);
	for (const name of shared) {
		const spec = declared(name);
		const major = spec === undefined ? undefined : majorOf(spec);
		if (major === undefined) continue;
		const hit = option.choices.find((c) => majorOf(c.devDependencies?.[name] ?? '') === major);
		if (hit) return hit.value;
	}
	return undefined;
}

// Recorded beats declared beats the option default. A recorded value that's no
// longer a choice (hand-edited state, a retired line) falls through rather than
// failing, since nobody chose it on this run.
export function lineDefault(
	option: UnitOption,
	recorded: string | undefined,
	declared: (name: string) => string | undefined,
): string {
	if (recorded !== undefined && option.choices.some((c) => c.value === recorded)) return recorded;
	return inferLineChoice(option, declared) ?? option.default;
}

function couplingFor(
	key: string,
	selected: ReadonlySet<string>,
	couplings: readonly OptionCoupling[],
): OptionCoupling | undefined {
	return couplings.find((c) => c.key === key && selected.has(c.when));
}

export function allowedValues(
	option: UnitOption,
	selected: ReadonlySet<string>,
	couplings: readonly OptionCoupling[] = OPTION_COUPLINGS,
): string[] {
	const coupling = couplingFor(option.key, selected, couplings);
	const values = option.choices.map((c) => c.value);
	return coupling ? values.filter((v) => coupling.allowed.includes(v)) : values;
}

// Nobody chose a defaulted value, so it bends to the coupling instead of failing.
export function constrain(
	key: string,
	value: string,
	selected: ReadonlySet<string>,
	couplings: readonly OptionCoupling[] = OPTION_COUPLINGS,
): string {
	const coupling = couplingFor(key, selected, couplings);
	return coupling && !coupling.allowed.includes(value) ? coupling.default : value;
}

export interface CouplingViolation {
	key: string;
	value: string;
	when: string;
	reason: string;
}

export function findCouplingViolation(
	selections: Record<string, string>,
	selected: ReadonlySet<string>,
	couplings: readonly OptionCoupling[] = OPTION_COUPLINGS,
): CouplingViolation | undefined {
	for (const c of couplings) {
		const value = selections[c.key];
		if (value !== undefined && selected.has(c.when) && !c.allowed.includes(value))
			return { key: c.key, value, when: c.when, reason: c.reason };
	}
	return undefined;
}

// A default line choice tracks npm latest like any other pin; only an older line
// is held, so --latest beside TS 6 writes ^6 instead of jumping to 7 (#159).
export function heldPins(
	units: readonly AnyUnit[],
	selections: Record<string, string>,
	lineOptions: readonly string[] = LINE_OPTIONS,
): Map<string, string> {
	const held = new Map<string, string>();
	for (const unit of units) {
		for (const option of unit.options ?? []) {
			if (!lineOptions.includes(option.key)) continue;
			const chosen = selections[option.key] ?? option.default;
			if (chosen === option.default) continue;
			const choice = option.choices.find((c) => c.value === chosen);
			for (const [name, pin] of Object.entries(choice?.devDependencies ?? {})) {
				const major = majorOf(pin);
				if (major !== undefined) held.set(name, `^${major}`);
			}
		}
	}
	return held;
}
