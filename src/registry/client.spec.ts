import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_REGISTRY, fetchLatestVersions } from './client';

// A fetch double serving abbreviated packuments: name → latest.
function fakeRegistry(latest: Record<string, string>): typeof fetch {
	return vi.fn(async (input: RequestInfo | URL) => {
		const url = String(input);
		const name = decodeURIComponent(url.slice(url.lastIndexOf('/') + 1));
		const version = latest[name];
		if (version === undefined)
			return new Response('not found', { status: 404 });
		return new Response(JSON.stringify({ 'dist-tags': { latest: version } }), { status: 200 });
	}) as unknown as typeof fetch;
}

describe('fetchLatestVersions', () => {
	it('resolves the latest dist-tag for every name', async () => {
		const result = await fetchLatestVersions(['eslint', 'vitest'], {
			fetchImpl: fakeRegistry({ eslint: '9.41.0', vitest: '2.2.0' }),
		});
		expect(result.get('eslint')).toBe('9.41.0');
		expect(result.get('vitest')).toBe('2.2.0');
	});

	it('asks for the abbreviated packument, not the full document', async () => {
		// The full packument for a popular package is megabytes; the abbreviated
		// form is the difference between a snappy check and a slow one.
		const fetchImpl = fakeRegistry({ eslint: '9.41.0' });
		await fetchLatestVersions(['eslint'], { fetchImpl });
		const init = vi.mocked(fetchImpl).mock.calls[0]?.[1] as RequestInit;
		expect(new Headers(init.headers).get('accept')).toContain('application/vnd.npm.install-v1+json');
	});

	it('percent-encodes the slash in scoped names', async () => {
		const fetchImpl = fakeRegistry({ '@antfu/eslint-config': '3.0.0' });
		const result = await fetchLatestVersions(['@antfu/eslint-config'], { fetchImpl });
		expect(result.get('@antfu/eslint-config')).toBe('3.0.0');
		const url = String(vi.mocked(fetchImpl).mock.calls[0]?.[0]);
		expect(url).toBe(`${DEFAULT_REGISTRY}/@antfu%2Feslint-config`);
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
		await fetchLatestVersions(names, { fetchImpl, concurrency: 3 });
		expect(peak).toBeLessThanOrEqual(3);
	});

	it('turns a non-OK response into an error naming the package and registry', async () => {
		await expect(fetchLatestVersions(['ghost-package'], { fetchImpl: fakeRegistry({}) }))
			.rejects
			.toThrow(/ghost-package.*registry\.npmjs\.org|registry\.npmjs\.org.*ghost-package/);
	});

	it('turns a hung request into a timeout error instead of hanging', async () => {
		// A fetch that only settles when its signal aborts — the shape of a
		// firewalled or blackholed registry.
		const fetchImpl = ((_url: RequestInfo | URL, init?: RequestInit) =>
			new Promise((_resolve, reject) => {
				init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
			})) as unknown as typeof fetch;

		await expect(fetchLatestVersions(['eslint'], { fetchImpl, timeoutMs: 20 }))
			.rejects
			.toThrow(/eslint/);
	});
});
