// The CLI's first network code, kept to one purpose: "what is the latest
// published version of these packages?". Everything is injectable — fetch for
// tests, the registry URL for corporate mirrors and the e2e's local server —
// and every request is time-boxed, because `unbranded outdated` hanging on a
// firewalled registry would be worse than it failing.

export const DEFAULT_REGISTRY = 'https://registry.npmjs.org';

export interface FetchLatestOpts {
	registry?: string;
	fetchImpl?: typeof fetch;
	timeoutMs?: number;
	concurrency?: number;
}

// Batched lookup of the `latest` dist-tag per package. Rejects on the FIRST
// failure with one clear error (offline degrades to a message, not a hang or a
// half-report); the rest of the pool is abandoned.
export async function fetchLatestVersions(names: string[], opts: FetchLatestOpts = {}): Promise<Map<string, string>> {
	const registry = (opts.registry ?? DEFAULT_REGISTRY).replace(/\/$/, '');
	const fetchImpl = opts.fetchImpl ?? fetch;
	const timeoutMs = opts.timeoutMs ?? 10_000;
	const concurrency = opts.concurrency ?? 8;

	const latest = new Map<string, string>();
	const queue = [...names];

	// A worker-pool cap rather than one request per package all at once: forty
	// parallel hits on a corporate mirror is a good way to get rate-limited.
	const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
		for (let name = queue.shift(); name !== undefined; name = queue.shift())
			latest.set(name, await latestOf(name, registry, fetchImpl, timeoutMs));
	});
	await Promise.all(workers);

	return latest;
}

async function latestOf(name: string, registry: string, fetchImpl: typeof fetch, timeoutMs: number): Promise<string> {
	// Scoped names keep the @ but encode the slash — the registry route wants
	// one path segment per package.
	const url = `${registry}/${name.replace('/', '%2F')}`;

	let response: Response;
	try {
		response = await fetchImpl(url, {
			// The abbreviated packument: full documents for popular packages run to
			// megabytes, and dist-tags is all this ever reads.
			headers: { accept: 'application/vnd.npm.install-v1+json' },
			signal: AbortSignal.timeout(timeoutMs),
		});
	}
	catch (err) {
		throw new Error(`couldn't reach ${registry} for ${name}: ${err instanceof Error ? err.message : String(err)}`);
	}

	if (!response.ok)
		throw new Error(`${registry} answered ${response.status} for ${name}.`);

	const body = await response.json() as { 'dist-tags'?: { latest?: string } };
	const version = body['dist-tags']?.latest;
	if (typeof version !== 'string')
		throw new Error(`${registry} returned no latest dist-tag for ${name}.`);
	return version;
}
