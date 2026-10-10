import type { AnyUnit, PinLine } from './types';

// Split out of pin-drift.spec so the neither-line case can be tested with a fake
// install. A pin with alternate lines (core-typescript's TS 6 and 7) passes when the
// installed major matches any line, so the repo can sit on either during a move.
// Option choices count as pins too, same as `outdated`: a flavor's devDependency
// drifts just like a static one.
export function findPinDrift(
	units: readonly AnyUnit[],
	lines: readonly PinLine[],
	installedVersion: (name: string) => string | undefined,
): string[] {
	const mismatches: string[] = [];
	for (const unit of units) {
		const sources = [unit.dependencies, unit.devDependencies];
		for (const option of unit.options ?? []) {
			for (const choice of option.choices)
				sources.push(choice.dependencies, choice.devDependencies);
		}
		for (const source of sources) {
			for (const [name, pin] of Object.entries(source ?? {})) {
				const candidates = [
					pin,
					...lines
						.filter((l) => l.unit === unit.id && l.devDependencies[name] !== undefined)
						.map((l) => l.devDependencies[name] as string),
				];
				const majors = candidates
					.map((p) => /^(\d+)\.\d+\.\d+$/.exec(p)?.[1])
					.filter((m): m is string => m !== undefined);
				if (majors.length === 0) continue;
				const installed = installedVersion(name);
				const installedMajor =
					installed === undefined ? undefined : /^(\d+)\.\d+\.\d+/.exec(installed)?.[1];
				if (installedMajor === undefined) continue;
				if (!majors.includes(installedMajor))
					mismatches.push(
						`${name}: manifest pins ${candidates.join(' or ')}, node_modules has ${installed}`,
					);
			}
		}
	}
	return [...new Set(mismatches)];
}
