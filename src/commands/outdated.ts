import type { Unit, UnitId } from '../manifest/types';
import { UNITS } from '../manifest/index';
import { DEFAULT_REGISTRY, fetchLatestVersions } from '../registry/client';

// Exact pins are the right default, but they rot. `outdated` is the freshness
// check: every pin in the manifest (flavor choices included) against the
// registry's latest dist-tag. Read-only, no TTY, exit 0 by default so a report
// never fails a job; --strict trips only on majors, which is the gate the
// maintainer-side bump automation cares about.
export const OUTDATED_SCHEMA = 1;

export interface ManifestPin {
	name: string;
	pin: string;
	// Every unit that declares the pin, so bump PRs can group per unit.
	units: UnitId[];
}

// Walks static deps/devDeps plus every option choice's — generic on purpose, so
// a future option-bearing unit is covered without anyone remembering this file.
export function collectManifestPins(units: Unit[]): ManifestPin[] {
	const byName = new Map<string, ManifestPin>();
	const add = (name: string, pin: string, unit: UnitId): void => {
		const entry = byName.get(name);
		if (entry === undefined)
			byName.set(name, { name, pin, units: [unit] });
		else if (!entry.units.includes(unit))
			entry.units.push(unit);
	};

	for (const unit of units) {
		const sources = [unit.dependencies, unit.devDependencies];
		for (const option of unit.options ?? []) {
			for (const choice of option.choices)
				sources.push(choice.dependencies, choice.devDependencies);
		}
		for (const source of sources) {
			for (const [name, pin] of Object.entries(source ?? {}))
				add(name, pin, unit.id);
		}
	}

	return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export type Behind = 'up-to-date' | 'patch' | 'minor' | 'major' | 'unknown';

// Grade by the most significant segment that moved. A registry behind the pin
// (stale mirror) counts as up to date: there is nothing to bump. Anything that
// isn't an exact x.y.z on both sides is unknown rather than a guess.
export function classifyBehind(pin: string, latest: string): Behind {
	const p = parseExact(pin);
	const l = parseExact(latest);
	if (!p || !l)
		return 'unknown';
	if (l[0] !== p[0])
		return l[0] > p[0] ? 'major' : 'up-to-date';
	if (l[1] !== p[1])
		return l[1] > p[1] ? 'minor' : 'up-to-date';
	if (l[2] !== p[2])
		return l[2] > p[2] ? 'patch' : 'up-to-date';
	return 'up-to-date';
}

function parseExact(spec: string): [number, number, number] | undefined {
	const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(spec);
	if (!match)
		return undefined;
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
}

export async function runOutdated(opts: RunOutdatedOpts = {}): Promise<number> {
	// Same resolution a package manager would use: explicit flag, then the env
	// npm/pnpm set for scripts, then the public registry.
	const registry = opts.registry ?? process.env.npm_config_registry ?? DEFAULT_REGISTRY;
	const pins = collectManifestPins(UNITS);

	let latest: Map<string, string>;
	try {
		latest = await fetchLatestVersions(pins.map(p => p.name), {
			registry,
			fetchImpl: opts.fetchImpl,
			timeoutMs: opts.timeoutMs,
		});
	}
	catch (err) {
		process.stderr.write(`unbranded outdated: ${err instanceof Error ? err.message : String(err)}\n`);
		return 1;
	}

	const entries: OutdatedEntry[] = pins.map((p) => {
		const version = latest.get(p.name) ?? '';
		return { ...p, latest: version, behind: classifyBehind(p.pin, version) };
	});
	const majors = entries.filter(e => e.behind === 'major').length;

	if (opts.json) {
		process.stdout.write(`${JSON.stringify({
			schema: OUTDATED_SCHEMA,
			registry,
			majorsBehind: majors,
			packages: entries,
		}, null, 2)}\n`);
	}
	else {
		process.stdout.write(formatOutdated(entries, registry));
	}

	return opts.strict && majors > 0 ? 1 : 0;
}

function formatOutdated(entries: OutdatedEntry[], registry: string): string {
	const stale = entries.filter(e => e.behind !== 'up-to-date');
	const lines: string[] = [];

	if (stale.length === 0) {
		lines.push(`All ${entries.length} manifest pins are up to date (checked against ${registry}).`);
		return `${lines.join('\n')}\n`;
	}

	const nameWidth = Math.max(...stale.map(e => e.name.length));
	const pinWidth = Math.max(...stale.map(e => e.pin.length));
	for (const e of stale) {
		const grade = e.behind === 'unknown' ? 'unparsable' : `${e.behind} behind`;
		lines.push(`  ${e.name.padEnd(nameWidth)}  ${e.pin.padStart(pinWidth)} → ${e.latest || '?'}  (${grade})  [${e.units.join(', ')}]`);
	}

	const majors = stale.filter(e => e.behind === 'major').length;
	lines.push('');
	lines.push(`${entries.length} pins checked against ${registry}: ${entries.length - stale.length} up to date, ${stale.length} behind (${majors} major${majors === 1 ? '' : 's'}).`);
	return `${lines.join('\n')}\n`;
}
