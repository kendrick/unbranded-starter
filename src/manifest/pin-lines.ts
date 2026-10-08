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
