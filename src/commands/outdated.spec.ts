import type { PinLine, Unit, UnitId } from '../manifest/types';
import type { ManifestPin } from './outdated';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PIN_LINES, UNITS } from '../manifest/index';
import { classifyBehind, collectManifestPins, newestInLine, runOutdated } from './outdated';

function unit(id: UnitId, extras: Partial<Unit> = {}): Unit {
	return { id, category: 'lint', label: id, description: '', files: [], ...extras };
}

// One minor above `pin` (e.g. 4.1.10 → 4.2.0). Fixtures that want a minor-behind
// scenario derive it from the live pin instead of a literal, so a weekly pin bump
// can't quietly turn "behind" into "up to date" and redden the suite (see #81).
function oneMinorAhead(pin: string): string {
	const [major = 0, minor = 0] = pin.split('.').map(Number);
	return `${major}.${minor + 1}.0`;
}

describe('collectManifestPins', () => {
	it('unions static deps, devDeps, and every option choice, attributing units', () => {
		const catalog = [
			unit('core-typescript', { devDependencies: { typescript: '5.9.3' } }),
			unit('core-eslint', {
				options: [
					{
						key: 'eslintFlavor',
						label: 'flavor',
						default: 'base',
						choices: [
							{
								value: 'base',
								label: 'Base',
								devDependencies: { 'eslint': '9.39.4', '@antfu/eslint-config': '6.2.3' },
							},
							{
								value: 'react',
								label: 'React',
								devDependencies: { 'eslint': '9.39.4', 'eslint-plugin-jsx-a11y': '6.10.2' },
							},
						],
					},
				],
			}),
			unit('opt-shadcn', {
				dependencies: { clsx: '2.1.1' },
				devDependencies: { typescript: '5.9.3' },
			}),
		];

		// No held lines: this case is about the unit walk alone.
		const pins = collectManifestPins(catalog, []);
		const byName = new Map(pins.map((p) => [p.name, p]));

		// Flavor-only deps are reachable without special-casing the eslint unit.
		expect(byName.get('eslint-plugin-jsx-a11y')?.pin).toBe('6.10.2');
		// A name two units pin appears once, attributed to both.
		expect(byName.get('typescript')?.units).toEqual(['core-typescript', 'opt-shadcn']);
		// Deduped within a unit across choices.
		expect(byName.get('eslint')?.units).toEqual(['core-eslint']);
		// Sorted by name for a stable report.
		expect(pins.map((p) => p.name)).toEqual([...pins.map((p) => p.name)].sort());
	});

	it("reaches every pin in the real manifest, including the flavor system's", () => {
		const names = new Set(collectManifestPins(UNITS).map((p) => p.name));
		expect(names.has('eslint')).toBe(true); // lives only in flavor choices
		expect(names.has('typescript')).toBe(true);
		expect(names.has('vitest')).toBe(true);
	});

	it('emits a PIN_LINES pin as its own entry carrying its major as line', () => {
		const catalog = [unit('core-typescript', { devDependencies: { typescript: '7.0.2' } })];
		const lines: PinLine[] = [
			{ unit: 'core-typescript', when: 'core-eslint', devDependencies: { typescript: '6.0.3' } },
		];
		expect(collectManifestPins(catalog, lines)).toEqual([
			{ name: 'typescript', pin: '7.0.2', units: ['core-typescript'] },
			{ name: 'typescript', pin: '6.0.3', units: ['core-typescript'], line: 6 },
		]);
	});

	it('reaches the real PIN_LINES TS pin', () => {
		expect(
			collectManifestPins(UNITS)
				.filter((p) => p.name === 'typescript')
				.map((p) => p.line),
		).toEqual([undefined, 6]);
	});
});

describe('newestInLine', () => {
	it('picks the highest exact version inside the line, ignoring prereleases and other majors', () => {
		expect(
			newestInLine({ latest: '7.0.3', versions: ['6.0.3', '6.0.5', '6.1.0-beta', '7.0.3'] }, 6),
		).toBe('6.0.5');
		expect(newestInLine({ latest: '7.0.3', versions: [] }, 6)).toBe('');
	});
});

describe('classifyBehind', () => {
	it('grades the gap by the most significant moved segment', () => {
		expect(classifyBehind('9.39.4', '9.39.4')).toBe('up-to-date');
		expect(classifyBehind('9.39.4', '9.39.5')).toBe('patch');
		expect(classifyBehind('9.39.4', '9.41.0')).toBe('minor');
		expect(classifyBehind('9.39.4', '10.0.0')).toBe('major');
	});

	it('treats a registry that is behind the pin as up to date', () => {
		// A stale mirror can lag the manifest; there is nothing to bump.
		expect(classifyBehind('9.39.4', '9.38.0')).toBe('up-to-date');
	});

	it('reports unknown for anything it cannot parse as an exact pin', () => {
		expect(classifyBehind('latest', '9.39.4')).toBe('unknown');
		expect(classifyBehind('^9.0.0', '9.39.4')).toBe('unknown');
		expect(classifyBehind('9.39.4', '10.0.0-beta.1')).toBe('unknown');
	});
});

describe('runOutdated', () => {
	let out: string[];
	let err: string[];

	beforeEach(() => {
		out = [];
		err = [];
		vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
			out.push(String(chunk));
			return true;
		});
		vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
			err.push(String(chunk));
			return true;
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	// Serves every real manifest pin back as published, with the highest pin of a
	// name as latest, so a held pin and its unheld twin are both current. A bare
	// string override replaces only latest.
	function echoRegistry(
		overrides: Record<string, { latest: string; versions?: string[] } | string> = {},
	): typeof fetch {
		const pins = new Map<string, string[]>();
		for (const p of collectManifestPins(UNITS))
			pins.set(p.name, [...(pins.get(p.name) ?? []), p.pin]);
		return async (input: RequestInfo | URL) => {
			const url = String(input);
			const name = decodeURIComponent(url.slice(url.lastIndexOf('/') + 1));
			const published = pins.get(name) ?? [];
			const override =
				typeof overrides[name] === 'string' ? { latest: overrides[name] } : overrides[name];
			const latest = override?.latest ?? highest(published);
			const versions = override?.versions ?? published;
			return new Response(
				JSON.stringify({
					'dist-tags': { latest },
					'versions': Object.fromEntries(versions.map((v) => [v, {}])),
				}),
				{ status: 200 },
			);
		};
	}

	function highest(versions: string[]): string | undefined {
		const key = (v: string): number[] => v.split('.').map(Number);
		return [...versions]
			.sort((a, b) => {
				const [x, y] = [key(a), key(b)];
				return x[0]! - y[0]! || x[1]! - y[1]! || x[2]! - y[2]!;
			})
			.at(-1);
	}

	const tsRegistry: typeof fetch = async () =>
		new Response(
			JSON.stringify({
				'dist-tags': { latest: '7.0.3' },
				'versions': Object.fromEntries(['6.0.3', '6.0.5', '7.0.2', '7.0.3'].map((v) => [v, {}])),
			}),
			{ status: 200 },
		);

	it('exits 0 and says so when every pin is current, even under --strict', async () => {
		expect(
			await runOutdated({ fetchImpl: echoRegistry(), strict: true, registry: 'https://reg.test' }),
		).toBe(0);
		expect(out.join('')).toContain('up to date');
	});

	it('reports a stale pin with an arrow, exit 0 by default, 1 under --strict for majors', async () => {
		const fetchImpl = echoRegistry({ eslint: '99.0.0' });
		expect(await runOutdated({ fetchImpl, registry: 'https://reg.test' })).toBe(0);
		expect(out.join('')).toMatch(/eslint\s+\S+ → 99\.0\.0/);

		out.length = 0;
		expect(await runOutdated({ fetchImpl, strict: true, registry: 'https://reg.test' })).toBe(1);
	});

	it('keeps --strict quiet for minors: only majors gate CI', async () => {
		// A pin one minor behind should surface in the report but never gate --strict;
		// only majors do. Stage that off vitest's live pin so the case survives bumps.
		const vitestPin = collectManifestPins(UNITS).find((p) => p.name === 'vitest')!.pin;
		expect(
			await runOutdated({
				fetchImpl: echoRegistry({ vitest: oneMinorAhead(vitestPin) }),
				strict: true,
				registry: 'https://reg.test',
			}),
		).toBe(0);
		expect(out.join('')).toContain('vitest');
	});

	it('emits a schema-versioned JSON envelope', async () => {
		expect(
			await runOutdated({
				fetchImpl: echoRegistry({ eslint: '99.0.0' }),
				json: true,
				registry: 'https://reg.test',
			}),
		).toBe(0);
		const parsed = JSON.parse(out.join('')) as {
			schema: number;
			registry: string;
			majorsBehind: number;
			packages: { name: string; pin: string; latest: string; behind: string; units: string[] }[];
		};
		expect(parsed.schema).toBe(2);
		expect(parsed.registry).toBe('https://reg.test');
		expect(parsed.majorsBehind).toBe(1);
		const eslint = parsed.packages.find((p) => p.name === 'eslint');
		expect(eslint?.behind).toBe('major');
		expect(eslint?.units).toContain('core-eslint');
	});

	it('grades a held pin inside its line and an unheld one against latest', async () => {
		const pins: ManifestPin[] = [
			{ name: 'typescript', pin: '7.0.2', units: ['core-typescript'] },
			{ name: 'typescript', pin: '6.0.3', units: ['core-typescript'], line: 6 },
		];
		expect(
			await runOutdated({
				fetchImpl: tsRegistry,
				json: true,
				strict: true,
				registry: 'https://reg.test',
				pins,
			}),
		).toBe(0);
		const parsed = JSON.parse(out.join('')) as { majorsBehind: number; packages: unknown[] };
		expect(parsed.packages).toEqual([
			{
				name: 'typescript',
				pin: '7.0.2',
				units: ['core-typescript'],
				latest: '7.0.3',
				behind: 'patch',
			},
			{
				name: 'typescript',
				pin: '6.0.3',
				units: ['core-typescript'],
				line: 6,
				latest: '6.0.5',
				behind: 'patch',
			},
		]);
		expect(parsed.majorsBehind).toBe(0);
	});

	it('grades the same 6.0.3 pin major once it is not held', async () => {
		const pins: ManifestPin[] = [{ name: 'typescript', pin: '6.0.3', units: ['core-typescript'] }];
		expect(
			await runOutdated({
				fetchImpl: tsRegistry,
				json: true,
				strict: true,
				registry: 'https://reg.test',
				pins,
			}),
		).toBe(1);
		expect(
			(JSON.parse(out.join('')) as { packages: { behind: string }[] }).packages[0]?.behind,
		).toBe('major');
	});

	it('tags a stale held pin with its line in the text report', async () => {
		const pins: ManifestPin[] = [
			{ name: 'typescript', pin: '6.0.3', units: ['core-typescript'], line: 6 },
		];
		expect(await runOutdated({ fetchImpl: tsRegistry, registry: 'https://reg.test', pins })).toBe(
			0,
		);
		expect(out.join('')).toContain('6.0.3 → 6.0.5  (patch behind, held to 6.x)');
	});

	it('serves the real held TS pin as current from the echo registry', async () => {
		expect(PIN_LINES.some((l) => 'typescript' in l.devDependencies)).toBe(true);
		expect(
			await runOutdated({ fetchImpl: echoRegistry(), json: true, registry: 'https://reg.test' }),
		).toBe(0);
		const { packages } = JSON.parse(out.join('')) as {
			packages: (ManifestPin & { behind: string })[];
		};
		const held = packages.filter((p) => p.line !== undefined);
		expect(held.map((p) => [p.name, p.behind])).toEqual([['typescript', 'up-to-date']]);
	});

	it('degrades an unreachable registry to one clear error and exit 1', async () => {
		const fetchImpl = (async () => {
			throw new Error('ECONNREFUSED');
		}) as unknown as typeof fetch;
		expect(await runOutdated({ fetchImpl, registry: 'https://reg.test' })).toBe(1);
		expect(err.join('')).toContain('reg.test');
	});
});
