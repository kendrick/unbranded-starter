import type { AnyUnit, PinLine } from './types';
import { PIN_LINES } from './index';

// A unit's pins can depend on what else resolved (core-typescript's TS line). Runs
// wherever a resolved set becomes concrete units, beside applyUnitOptions, so the
// plan, the scaffold, and update all see the same line.
export function applyPinLines(unit: AnyUnit, selected: ReadonlySet<string>, lines: readonly PinLine[] = PIN_LINES): AnyUnit {
	const overrides = lines.filter(line => line.unit === unit.id && selected.has(line.when));
	if (overrides.length === 0)
		return unit;
	return {
		...unit,
		devDependencies: overrides.reduce<Record<string, string>>((pins, line) => ({ ...pins, ...line.devDependencies }), { ...unit.devDependencies }),
	};
}

// Under --latest, TS 7 beside typescript-eslint is the #131 break, so a PIN_LINES
// pin gets a caret on its own major instead of the dist-tag (#159). A pin is held
// only when it's an exact X.Y.Z, the same rule collectManifestPins uses, so
// outdated and --latest agree on which pins have a line. The plan note keeps the
// manifest's pins, because only the specs a run writes go through applyLatest.
export function applyLatest(unit: AnyUnit, selected: ReadonlySet<string>, lines: readonly PinLine[] = PIN_LINES): AnyUnit {
	const held = new Map<string, string>();
	for (const line of lines.filter(l => l.unit === unit.id && selected.has(l.when))) {
		for (const [name, pin] of Object.entries(line.devDependencies)) {
			const major = /^(\d+)\.\d+\.\d+$/.exec(pin)?.[1];
			if (major !== undefined)
				held.set(name, `^${major}`);
		}
	}
	// A PinLine holds only devDependencies, so a held name never reaches
	// `dependencies`.
	const rewrite = (deps: Record<string, string> | undefined, holds: ReadonlyMap<string, string>): Record<string, string> | undefined =>
		deps && Object.fromEntries(Object.keys(deps).map(name => [name, holds.get(name) ?? 'latest']));
	return { ...unit, dependencies: rewrite(unit.dependencies, new Map()), devDependencies: rewrite(unit.devDependencies, held) };
}

// The specs a run writes. runPlanJson's envelope and runInit's install both call
// this, so a dry run can't report a spec the real run wouldn't write.
export function specsToWrite(units: AnyUnit[], selected: ReadonlySet<string>, latest: boolean, lines: readonly PinLine[] = PIN_LINES): AnyUnit[] {
	return latest ? units.map(u => applyLatest(u, selected, lines)) : units;
}
