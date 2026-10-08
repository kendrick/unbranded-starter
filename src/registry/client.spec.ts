import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_REGISTRY, fetchVersions } from './client';

// A fetch double serving abbreviated packuments: name → latest (+ versions).
function fakeRegistry(packages: Record<string, { latest: string; versions?: string[] }>): typeof fetch {
	return vi.fn(async (input: RequestInfo | URL) => {
		const url = String(input);
		const name = decodeURIComponent(url.slice(url.lastIndexOf('/') + 1));
		const pkg = packages[name];
		if (pkg === undefined)
			return new Response('not found', { status: 404 });
		const body: Record<string, unknown> = { 'dist-tags': { latest: pkg.latest } };
		if (pkg.versions !== undefined)
			body.versions = Object.fromEntries(pkg.versions.map(v => [v, {}]));
		return new Response(JSON.stringify(body), { status: 200 });
	});
}

describe('fetchVersions', () => {
	it('resolves the latest dist-tag for every name', async () => {
		const result = await fetchVersions(['eslint', 'vitest'], {
			fetchImpl: fakeRegistry({ eslint: { latest: '9.41.0' }, vitest: { latest: '2.2.0' } }),
		});
		expect(result.get('eslint')?.latest).toBe('9.41.0');
		expect(result.get('vitest')?.latest).toBe('2.2.0');
	});

	it('returns every published version key alongside the latest tag', async () => {
		const result = await fetchVersions(['typescript'], {
			fetchImpl: fakeRegistry({ typescript: { latest: '7.0.3', versions: ['6.0.3', '6.0.5', '7.0.2', '7.0.3'] } }),
		});
		expect(result.get('typescript')).toEqual({ latest: '7.0.3', versions: ['6.0.3', '6.0.5', '7.0.2', '7.0.3'] });
	});

	it('treats a packument with no versions map as an empty list', async () => {
		const result = await fetchVersions(['eslint'], { fetchImpl: fakeRegistry({ eslint: { latest: '9.41.0' } }) });
		expect(result.get('eslint')).toEqual({ latest: '9.41.0', versions: [] });
	});

	it('asks for the abbreviated packument, not the full document', async () => {
		// The full packument for a popular package is megabytes; the abbreviated
		// form is the difference between a snappy check and a slow one.
		const fetchImpl = fakeRegistry({ eslint: { latest: '9.41.0' } });
		await fetchVersions(['eslint'], { fetchImpl });
		const init = vi.mocked(fetchImpl).mock.calls[0]?.[1] as RequestInit;
		expect(new Headers(init.headers).get('accept')).toContain('application/vnd.npm.install-v1+json');
	});

	it('percent-encodes the slash in scoped names', async () => {
		const fetchImpl = fakeRegistry({ '@antfu/eslint-config': { latest: '3.0.0' } });
		const result = await fetchVersions(['@antfu/eslint-config'], { fetchImpl });
		expect(result.get('@antfu/eslint-config')?.latest).toBe('3.0.0');
		const url = String(vi.mocked(fetchImpl).mock.calls[0]?.[0]);
		expect(url).toBe(`${DEFAULT_REGISTRY}/@antfu%2Feslint-config`);
	});

	it('encodes every slash, not just the first', async () => {
		// A name with two slashes can only arrive from a --units-dir pack, but
		// encoding just the first would leave a real separator in the path and
		// let the rest of the name traverse off the package route.
		const name = '@scope/pkg/../../evil';
		const fetchImpl = fakeRegistry({ [name]: { latest: '1.0.0' } });
		await fetchVersions([name], { fetchImpl });
		const url = String(vi.mocked(fetchImpl).mock.calls[0]?.[0]);
		expect(url).toBe(`${DEFAULT_REGISTRY}/@scope%2Fpkg%2F..%2F..%2Fevil`);
		expect(new URL(url).pathname).not.toContain('/..');
	});

	it('caps in-flight requests at the concurrency limit', async () => {
		let inFlight = 0;
		let peak = 0;
		const fetchImpl = (async () => {
			inFlight += 1;
			peak = Math.max(peak, inFlight);
			await new Promise(resolve => setTimeout(resolve, 5));
			inFlight -= 1;
			return new Response(JSON.stringify({ 'dist-tags': { latest: '1.0.0' } }), { status: 200 });
		}) as unknown as typeof fetch;

		const names = Array.from({ length: 10 }, (_, i) => `pkg-${i}`);
		await fetchVersions(names, { fetchImpl, concurrency: 3 });
		expect(peak).toBeLessThanOrEqual(3);
	});

	it('turns a non-OK response into an error naming the package and registry', async () => {
		await expect(fetchVersions(['ghost-package'], { fetchImpl: fakeRegistry({}) }))
			.rejects
			.toThrow(/ghost-package.*registry\.npmjs\.org|registry\.npmjs\.org.*ghost-package/);
	});

	it('turns a hung request into a timeout error instead of hanging', async () => {
		// A fetch that only settles when its signal aborts — the shape of a
		// firewalled or blackholed registry.
		const fetchImpl = (async (_url: RequestInfo | URL, init?: RequestInit) =>
			new Promise((_resolve, reject) => {
				init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
			})) as unknown as typeof fetch;

		await expect(fetchVersions(['eslint'], { fetchImpl, timeoutMs: 20 }))
			.rejects
			.toThrow(/eslint/);
	});
});
