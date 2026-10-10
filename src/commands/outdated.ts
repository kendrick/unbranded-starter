import type { PinLine, Unit, UnitId } from '../manifest/types';
import type { PackageVersions } from '../registry/client';
import { PIN_LINES, UNITS } from '../manifest/index';
import { DEFAULT_REGISTRY, fetchVersions } from '../registry/client';

// Exact pins are the right default, but they rot. `outdated` is the freshness
// check: every pin in the manifest (flavor choices included) against the
// registry's latest dist-tag, or for a PIN_LINES pin the newest version inside
// its held major (#159). Read-only, no TTY, exit 0 by default so a report
// never fails a job; --strict trips only on majors, which is the gate the
// maintainer-side bump automation cares about.
export const OUTDATED_SCHEMA = 2;

export interface ManifestPin {
	name: string;
	pin: string;
	// Every unit that declares the pin, so bump PRs can group per unit.
	units: UnitId[];
	// Set when the pin comes from PIN_LINES: the major it's held to, so it's
	// graded and bumped inside that line (#159). typescript-eslint can't load
	// TS 7 (#131).
	line?: number;
}

// Walks static deps/devDeps plus every option choice's — generic on purpose, so
// a future option-bearing unit is covered without anyone remembering this file.
export function collectManifestPins(
	units: Unit[],
	lines: readonly PinLine[] = PIN_LINES,
): ManifestPin[] {
	// A held pin keys on name@pin, so it never merges into the unit walk's entry
	// for the same name. The two share a name but grade against different
	// targets.
	const byKey = new Map<string, ManifestPin>();
	const add = (key: string, pin: Omit<ManifestPin, 'units'>, unit: UnitId): void => {
		const entry = byKey.get(key);
		if (entry === undefined) byKey.set(key, { ...pin, units: [unit] });
		else if (!entry.units.includes(unit)) entry.units.push(unit);
	};

	for (const unit of units) {
		const sources = [unit.dependencies, unit.devDependencies];
		for (const option of unit.options ?? []) {
			for (const choice of option.choices)
				sources.push(choice.dependencies, choice.devDependencies);
		}
		for (const source of sources) {
			for (const [name, pin] of Object.entries(source ?? {})) add(name, { name, pin }, unit.id);
		}
	}

	for (const line of lines) {
		for (const [name, pin] of Object.entries(line.devDependencies)) {
			// An unparsable held pin has no major to hold it to.
			const major = parseExact(pin)?.[0];
			if (major !== undefined)
				add(`${name}@${pin}`, { name, pin, line: major }, line.unit as UnitId);
		}
	}

	return [...byKey.values()].sort(
		(a, b) => a.name.localeCompare(b.name) || (a.line ?? -1) - (b.line ?? -1),
	);
}

// The newest exact release inside `line`'s major. Prereleases stay out for the
// same reason classifyBehind calls them unknown: nobody pins a beta on purpose.
// '' when the line has nothing published, which grades as unknown.
export function newestInLine(info: PackageVersions, line: number): string {
	let best: [number, number, number] | undefined;
	let bestSpec = '';
	for (const spec of [...info.versions, info.latest]) {
		const v = parseExact(spec);
		if (!v || v[0] !== line) continue;
		if (!best || v[1] > best[1] || (v[1] === best[1] && v[2] > best[2])) {
			best = v;
			bestSpec = spec;
		}
	}
	return bestSpec;
}

export type Behind = 'up-to-date' | 'patch' | 'minor' | 'major' | 'unknown';

// Grade by the most significant segment that moved. A registry behind the pin
// (stale mirror) counts as up to date: there is nothing to bump. Anything that
// isn't an exact x.y.z on both sides is unknown rather than a guess.
export function classifyBehind(pin: string, latest: string): Behind {
	const p = parseExact(pin);
	const l = parseExact(latest);
	if (!p || !l) return 'unknown';
	if (l[0] !== p[0]) return l[0] > p[0] ? 'major' : 'up-to-date';
	if (l[1] !== p[1]) return l[1] > p[1] ? 'minor' : 'up-to-date';
	if (l[2] !== p[2]) return l[2] > p[2] ? 'patch' : 'up-to-date';
	return 'up-to-date';
}

function parseExact(spec: string): [number, number, number] | undefined {
	const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(spec);
	if (!match) return undefined;
	return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export interface OutdatedEntry extends ManifestPin {
	latest: string;
	behind: Behind;
}

export interface RunOutdatedOpts {
	json?: boolean;
	// Exit non-zero when majors are behind, so maintainers can CI the freshness.
	strict?: boolean;
	registry?: string;
	// Injected by tests; the e2e goes through a real local HTTP server instead.
	fetchImpl?: typeof fetch;
	timeoutMs?: number;
	// Injected by tests so a fixture can be literal instead of the live manifest.
	pins?: ManifestPin[];
}

export async function runOutdated(opts: RunOutdatedOpts = {}): Promise<number> {
	// Same resolution a package manager would use: explicit flag, then the env
	// npm/pnpm set for scripts, then the public registry.
	const registry = opts.registry ?? process.env.npm_config_registry ?? DEFAULT_REGISTRY;
	const pins = opts.pins ?? collectManifestPins(UNITS);

	let found: Map<string, PackageVersions>;
	try {
		// Deduped: a held pin and its unheld twin share one packument.
		found = await fetchVersions([...new Set(pins.map((p) => p.name))], {
			registry,
			fetchImpl: opts.fetchImpl,
			timeoutMs: opts.timeoutMs,
		});
	} catch (err) {
		process.stderr.write(
			`unbranded outdated: ${err instanceof Error ? err.message : String(err)}\n`,
		);
		return 1;
	}

	const entries: OutdatedEntry[] = pins.map((p) => {
		const info = found.get(p.name) ?? { latest: '', versions: [] };
		const target = p.line === undefined ? info.latest : newestInLine(info, p.line);
		return { ...p, latest: target, behind: classifyBehind(p.pin, target) };
	});
	const majors = entries.filter((e) => e.behind === 'major').length;

	if (opts.json) {
		process.stdout.write(
			`${JSON.stringify(
				{
					schema: OUTDATED_SCHEMA,
					registry,
					majorsBehind: majors,
					packages: entries,
				},
				null,
				2,
			)}\n`,
		);
	} else {
		process.stdout.write(formatOutdated(entries, registry));
	}

	return opts.strict && majors > 0 ? 1 : 0;
}

function formatOutdated(entries: OutdatedEntry[], registry: string): string {
	const stale = entries.filter((e) => e.behind !== 'up-to-date');
	const lines: string[] = [];

	if (stale.length === 0) {
		lines.push(`All ${entries.length} manifest pins are up to date (checked against ${registry}).`);
		return `${lines.join('\n')}\n`;
	}

	const nameWidth = Math.max(...stale.map((e) => e.name.length));
	const pinWidth = Math.max(...stale.map((e) => e.pin.length));
	for (const e of stale) {
		const grade = e.behind === 'unknown' ? 'unparsable' : `${e.behind} behind`;
		const heldNote = e.line === undefined ? '' : `, held to ${e.line}.x`;
		lines.push(
			`  ${e.name.padEnd(nameWidth)}  ${e.pin.padStart(pinWidth)} → ${e.latest || '?'}  (${grade}${heldNote})  [${e.units.join(', ')}]`,
		);
	}

	const majors = stale.filter((e) => e.behind === 'major').length;
	lines.push('');
	lines.push(
		`${entries.length} pins checked against ${registry}: ${entries.length - stale.length} up to date, ${stale.length} behind (${majors} major${majors === 1 ? '' : 's'}).`,
	);
	return `${lines.join('\n')}\n`;
}
