import type { Unit, UnitId } from '../manifest/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UNITS } from '../manifest/index';
import { classifyBehind, collectManifestPins, runOutdated } from './outdated';

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
				options: [{
					key: 'eslintFlavor',
					label: 'flavor',
					default: 'base',
					choices: [
						{ value: 'base', label: 'Base', devDependencies: { 'eslint': '9.39.4', '@antfu/eslint-config': '6.2.3' } },
						{ value: 'react', label: 'React', devDependencies: { 'eslint': '9.39.4', 'eslint-plugin-jsx-a11y': '6.10.2' } },
					],
				}],
			}),
			unit('opt-shadcn', { dependencies: { clsx: '2.1.1' }, devDependencies: { typescript: '5.9.3' } }),
		];

		const pins = collectManifestPins(catalog);
		const byName = new Map(pins.map(p => [p.name, p]));

		// Flavor-only deps are reachable without special-casing the eslint unit.
		expect(byName.get('eslint-plugin-jsx-a11y')?.pin).toBe('6.10.2');
		// A name two units pin appears once, attributed to both.
		expect(byName.get('typescript')?.units).toEqual(['core-typescript', 'opt-shadcn']);
		// Deduped within a unit across choices.
		expect(byName.get('eslint')?.units).toEqual(['core-eslint']);
		// Sorted by name for a stable report.
		expect(pins.map(p => p.name)).toEqual([...pins.map(p => p.name)].sort());
	});

	it('reaches every pin in the real manifest, including the flavor system\'s', () => {
		const names = new Set(collectManifestPins(UNITS).map(p => p.name));
		expect(names.has('eslint')).toBe(true); // lives only in flavor choices
		expect(names.has('typescript')).toBe(true);
		expect(names.has('vitest')).toBe(true);
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

	// Serves every real manifest pin back verbatim, except the overrides.
	function echoRegistry(overrides: Record<string, string> = {}): typeof fetch {
		const pins = new Map(collectManifestPins(UNITS).map(p => [p.name, p.pin]));
		return (async (input: RequestInfo | URL) => {
			const url = String(input);
			const name = decodeURIComponent(url.slice(url.lastIndexOf('/') + 1));
			const latest = overrides[name] ?? pins.get(name);
			return new Response(JSON.stringify({ 'dist-tags': { latest } }), { status: 200 });
		}) as typeof fetch;
	}

	it('exits 0 and says so when every pin is current, even under --strict', async () => {
		expect(await runOutdated({ fetchImpl: echoRegistry(), strict: true, registry: 'https://reg.test' })).toBe(0);
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
		const vitestPin = collectManifestPins(UNITS).find(p => p.name === 'vitest')!.pin;
		expect(await runOutdated({ fetchImpl: echoRegistry({ vitest: oneMinorAhead(vitestPin) }), strict: true, registry: 'https://reg.test' })).toBe(0);
		expect(out.join('')).toContain('vitest');
	});

	it('emits a schema-versioned JSON envelope', async () => {
		expect(await runOutdated({ fetchImpl: echoRegistry({ eslint: '99.0.0' }), json: true, registry: 'https://reg.test' })).toBe(0);
		const parsed = JSON.parse(out.join('')) as {
			schema: number;
			registry: string;
			majorsBehind: number;
			packages: { name: string; pin: string; latest: string; behind: string; units: string[] }[];
		};
		expect(parsed.schema).toBe(1);
		expect(parsed.registry).toBe('https://reg.test');
		expect(parsed.majorsBehind).toBe(1);
		const eslint = parsed.packages.find(p => p.name === 'eslint');
		expect(eslint?.behind).toBe('major');
		expect(eslint?.units).toContain('core-eslint');
	});

	it('degrades an unreachable registry to one clear error and exit 1', async () => {
		const fetchImpl = (async () => {
			throw new Error('ECONNREFUSED');
		}) as unknown as typeof fetch;
		expect(await runOutdated({ fetchImpl, registry: 'https://reg.test' })).toBe(1);
		expect(err.join('')).toContain('reg.test');
	});
});
