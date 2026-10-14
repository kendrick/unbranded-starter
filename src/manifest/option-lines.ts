import type { AnyUnit, OptionCoupling, UnitOption } from './types';
import { LINE_OPTIONS, OPTION_COUPLINGS } from './index';

// One version or one-major range: ^6, ~6.0, 6.x, =6.0.3, v6.0.3, 6.0.3-rc.1.
// '^6' is what --latest writes for a held line, so a bare major counts too.
const SINGLE = /^(?:[\^~]|=)?v?(\d+)(?:\.(?:\d+|[xX*])){0,2}(?:[-+][0-9A-Za-z.-]+)?$/;
// A bounded range, `>=6.0.0 <7`. Open-ended `>=6` admits 7, so it names no line.
const BOUNDED = /^>=\s*v?(\d+)(?:\.\d+){0,2}\s+<\s*v?(\d+)((?:\.\d+){0,2})$/;

// A hyphen range, `6.0.0 - 6.9.9`. It names a line only when both ends share a major.
const HYPHEN = /^v?(\d+)(?:\.(?:\d+|[xX*])){0,2}\s+-\s+v?(\d+)(?:\.(?:\d+|[xX*])){0,2}$/;

// The major a declared range holds to. A range that spans majors or isn't semver
// at all (latest, *, git/file/workspace specs, a `||` union) gets undefined, which
// sends inference to the default line instead of a guess.
export function majorOf(spec: string): number | undefined {
	const s = spec.trim();
	const single = SINGLE.exec(s);
	if (single) return Number(single[1]);
	const hyphen = HYPHEN.exec(s);
	if (hyphen) return hyphen[1] === hyphen[2] ? Number(hyphen[1]) : undefined;
	const bounded = BOUNDED.exec(s);
	if (!bounded) return undefined;
	const lower = Number(bounded[1]);
	const upper = Number(bounded[2]);
	const upperIsZero = /^(?:\.0){0,2}$/.test(bounded[3] ?? '');
	// `<7` and `<7.0.0` stop at the next major; `<6.5` stays inside this one.
	if (upper === lower + 1 && upperIsZero) return lower;
	if (upper === lower && !upperIsZero) return lower;
	return undefined;
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

// The line a run lands on when it doesn't name one. init and update both call
// this, so a project re-run through init and one updated in place can't disagree.
export function resolveLine(
	option: UnitOption,
	recorded: string | undefined,
	declared: (name: string) => string | undefined,
	selected: ReadonlySet<string>,
	couplings: readonly OptionCoupling[] = OPTION_COUPLINGS,
): string {
	return constrain(option.key, lineDefault(option, recorded, declared), selected, couplings);
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

// Under --latest, a pin held by a non-default line choice gets a caret on its own
// major instead of the dist-tag, so a TS 6 project isn't jumped to 7 (#159). The
// plan note keeps the manifest's pins, because only the specs a run writes go
// through applyLatest.
export function applyLatest(unit: AnyUnit, held: ReadonlyMap<string, string>): AnyUnit {
	// Line choices pin only devDependencies, so a held name never reaches
	// `dependencies`.
	const rewrite = (
		deps: Record<string, string> | undefined,
		holds: ReadonlyMap<string, string>,
	): Record<string, string> | undefined =>
		deps &&
		Object.fromEntries(Object.keys(deps).map((name) => [name, holds.get(name) ?? 'latest']));
	return {
		...unit,
		dependencies: rewrite(unit.dependencies, new Map()),
		devDependencies: rewrite(unit.devDependencies, held),
	};
}

// The specs a run writes. runPlanJson's envelope and runInit's install both call
// this, so a dry run can't report a spec the real run wouldn't write.
export function specsToWrite(
	units: AnyUnit[],
	held: ReadonlyMap<string, string>,
	latest: boolean,
): AnyUnit[] {
	return latest ? units.map((u) => applyLatest(u, held)) : units;
}
