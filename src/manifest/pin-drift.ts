import type { AnyUnit } from './types';

// Split out of pin-drift.spec so the neither-line case can be tested with a fake
// install. Alternate lines of a package are option choices now (core-typescript's
// typescriptLine), so a package passes when the installed major matches any pin a
// unit carries for it, static or choice, and the repo can sit on either line during
// a move. Choice pins count for the same reason `outdated` walks them: a flavor's
// devDependency drifts just like a static one.
export function findPinDrift(
	units: readonly AnyUnit[],
	installedVersion: (name: string) => string | undefined,
): string[] {
	const mismatches: string[] = [];
	for (const unit of units) {
		const sources = [unit.dependencies, unit.devDependencies];
		for (const option of unit.options ?? []) {
			for (const choice of option.choices)
				sources.push(choice.dependencies, choice.devDependencies);
		}
		const pinsByName = new Map<string, string[]>();
		for (const source of sources) {
			for (const [name, pin] of Object.entries(source ?? {})) {
				const pins = pinsByName.get(name) ?? [];
				if (!pins.includes(pin)) pins.push(pin);
				pinsByName.set(name, pins);
			}
		}
		for (const [name, pins] of pinsByName) {
			const majors = pins
				.map((p) => /^(\d+)\.\d+\.\d+$/.exec(p)?.[1])
				.filter((m): m is string => m !== undefined);
			if (majors.length === 0) continue;
			const installed = installedVersion(name);
			const installedMajor =
				installed === undefined ? undefined : /^(\d+)\.\d+\.\d+/.exec(installed)?.[1];
			if (installedMajor === undefined) continue;
			if (!majors.includes(installedMajor))
				mismatches.push(
					`${name}: manifest pins ${pins.join(' or ')}, node_modules has ${installed}`,
				);
		}
	}
	return [...new Set(mismatches)];
}
