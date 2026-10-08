import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { collectManifestPins } from '../../src/commands/outdated';
import { UNITS } from '../../src/manifest/index';
import { PKG_ROOT } from '../../src/util/paths';

const CLI = join(PKG_ROOT, 'dist/cli.js');

// One minor above `pin` (e.g. 4.1.10 → 4.2.0). Fixtures that want a minor-behind
// scenario derive it from the live pin instead of a literal, so a weekly pin bump
// can't quietly turn "behind" into "up to date" and redden the suite (see #81).
function oneMinorAhead(pin: string): string {
	const [major = 0, minor = 0] = pin.split('.').map(Number);
	return `${major}.${minor + 1}.0`;
}

// Same idea one segment down, for a held pin that has to stay inside its major.
function onePatchAhead(pin: string): string {
	const [major = 0, minor = 0, patch = 0] = pin.split('.').map(Number);
	return `${major}.${minor}.${patch + 1}`;
}

function highest(versions: string[]): string | undefined {
	const key = (v: string): number[] => v.split('.').map(Number);
	return [...versions].sort((a, b) => {
		const [x, y] = [key(a), key(b)];
		return (x[0]! - y[0]!) || (x[1]! - y[1]!) || (x[2]! - y[2]!);
	}).at(-1);
}

// The registry lives in THIS process, so the CLI must be spawned async —
// spawnSync would block the event loop and deadlock the very server the child
// is trying to reach.
function run(args: string[]): Promise<{ status: number | null; stdout: string; stderr: string }> {
	return new Promise((resolve) => {
		const child = spawn('node', [CLI, ...args], { cwd: PKG_ROOT });
		let stdout = '';
		let stderr = '';
		child.stdout.on('data', (d: Buffer) => {
			stdout += d.toString();
		});
		child.stderr.on('data', (d: Buffer) => {
			stderr += d.toString();
		});
		child.on('close', status => resolve({ status, stdout, stderr }));
	});
}

describe('unbranded outdated (against a local registry)', () => {
	// Echoes every real manifest pin back as published, the highest of a name as
	// latest, minus per-test overrides—a registry where nothing moved unless the
	// test says so. Keyed to every pin of a name, since the held TS 6 pin and the
	// unheld TS 7 one share a packument. A bare string override replaces latest only.
	const allPins = collectManifestPins(UNITS);
	const pins = new Map<string, string[]>();
	for (const p of allPins)
		pins.set(p.name, [...(pins.get(p.name) ?? []), p.pin]);
	const overrides: Record<string, { latest: string; versions?: string[] } | string> = {};
	let server: Server;
	let registry: string;

	beforeAll(async () => {
		server = createServer((req, res) => {
			const name = decodeURIComponent((req.url ?? '/').slice(1));
			res.setHeader('content-type', 'application/json');
			const published = pins.get(name) ?? [];
			const override = typeof overrides[name] === 'string' ? { latest: overrides[name] } : overrides[name];
			res.end(JSON.stringify({
				'dist-tags': { latest: override?.latest ?? highest(published) ?? '0.0.0' },
				'versions': Object.fromEntries((override?.versions ?? published).map(v => [v, {}])),
			}));
		});
		await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
		registry = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	});

	beforeEach(() => {
		for (const key of Object.keys(overrides)) delete overrides[key];
	});

	afterAll(async () => {
		await new Promise(resolve => server.close(resolve));
	});

	it('exits 0 with a clean bill when every pin matches the registry', async () => {
		const result = await run(['outdated', '--strict', '--registry', registry]);
		expect(result.status, result.stderr).toBe(0);
		expect(result.stdout).toContain('up to date');
	});

	it('reports a major-behind pin; --strict turns it into a gate', async () => {
		overrides.eslint = '99.0.0';

		const report = await run(['outdated', '--registry', registry]);
		expect(report.status, report.stderr).toBe(0); // default never fails a job
		expect(report.stdout).toMatch(/eslint\s+\S+ → 99\.0\.0\s+\(major behind\)/);
		expect(report.stdout).toContain('core-eslint');

		const gated = await run(['outdated', '--strict', '--registry', registry]);
		expect(gated.status).toBe(1);
	});

	it('emits the schema-1 JSON envelope for tooling', async () => {
		overrides.vitest = oneMinorAhead(pins.get('vitest')![0]!);

		const result = await run(['outdated', '--json', '--registry', registry]);
		expect(result.status, result.stderr).toBe(0);
		const parsed = JSON.parse(result.stdout) as {
			schema: number;
			majorsBehind: number;
			packages: { name: string; behind: string; units: string[] }[];
		};
		expect(parsed.schema).toBe(1);
		expect(parsed.majorsBehind).toBe(0);
		expect(parsed.packages.find(p => p.name === 'vitest')?.behind).toBe('minor');
	});

	it('holds the 6.x pin to its line: --strict exits 0 when only it is behind, inside 6', async () => {
		const heldPin = allPins.find(p => p.name === 'typescript' && p.line === 6)!.pin;
		const unheldPin = allPins.find(p => p.name === 'typescript' && p.line === undefined)!.pin;
		overrides.typescript = { latest: unheldPin, versions: [heldPin, onePatchAhead(heldPin), unheldPin] };

		const result = await run(['outdated', '--json', '--strict', '--registry', registry]);
		expect(result.status, result.stderr).toBe(0);
		const parsed = JSON.parse(result.stdout) as { packages: { name: string; line?: number; latest: string; behind: string }[] };
		const held = parsed.packages.find(p => p.name === 'typescript' && p.line === 6);
		expect(held).toMatchObject({ behind: 'patch', line: 6, latest: onePatchAhead(heldPin) });
		// Nothing else moved, so the held pin is the only non-current entry.
		expect(parsed.packages.filter(p => p.behind !== 'up-to-date')).toEqual([held]);
	});

	it('fails fast with a clear error when the registry is unreachable', async () => {
		// A connection refused, not a hang: nothing listens on port 9.
		const result = await run(['outdated', '--registry', 'http://127.0.0.1:9']);
		expect(result.status).toBe(1);
		expect(result.stderr).toContain('127.0.0.1:9');
	});
});
