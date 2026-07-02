import type { Pm } from '../detect/pm';
import type { UnitId } from '../manifest/types';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface Config {
	units: UnitId[];
	pm: Pm | null;
	onConflict: 'overwrite' | 'skip';
	postInstall: 'all' | 'none';
	// Pinned to the manifest's exact versions by default; 'latest' rewrites
	// every dependency to the `latest` dist-tag. The `--latest` flag overrides
	// this per run (flag wins over the recipe field).
	versions: 'pinned' | 'latest';
	// Only required when the target cwd has no package.json (new-project mode);
	// in augment mode the directory already exists and this is ignored.
	projectName?: string;
}

const VALID_PMS = new Set<string>(['npm', 'pnpm', 'yarn', 'bun']);
const VALID_ON_CONFLICT = new Set(['overwrite', 'skip']);
const VALID_POST_INSTALL = new Set(['all', 'none']);
const VALID_VERSIONS = new Set(['pinned', 'latest']);

// v1 is JSON-only. YAML support is easy to add (we'd pull in `yaml` and key
// off the file extension) but isn't load-bearing for the E2E suite, which is
// what motivated this mode in the first place.
export function loadConfig(path: string, knownUnits: Set<UnitId>): Config {
	const abs = resolve(path);
	if (!existsSync(abs)) {
		throw new Error(`--config file not found: ${abs}`);
	}
	if (!/\.json$/i.test(abs)) {
		throw new Error(`--config currently supports .json only (got ${abs}).`);
	}

	let raw: unknown;
	try {
		raw = JSON.parse(readFileSync(abs, 'utf-8'));
	}
	catch (err) {
		throw new Error(`Invalid JSON in ${abs}: ${(err as Error).message}`);
	}

	return validate(raw, knownUnits);
}

export function validate(raw: unknown, knownUnits: Set<UnitId>): Config {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
		throw new Error('Config must be a JSON object.');
	}
	const obj = raw as Record<string, unknown>;

	if (!Array.isArray(obj.units)) {
		throw new TypeError('config.units must be an array of UnitId strings.');
	}
	const unknownUnits = obj.units.filter(
		u => typeof u !== 'string' || !knownUnits.has(u as UnitId),
	);
	if (unknownUnits.length > 0) {
		throw new Error(`config.units contains unknown ids: ${unknownUnits.join(', ')}`);
	}

	if (obj.pm !== null && (typeof obj.pm !== 'string' || !VALID_PMS.has(obj.pm))) {
		throw new Error(`config.pm must be one of: ${[...VALID_PMS].sort().join(', ')}, or null.`);
	}

	if (typeof obj.onConflict !== 'string' || !VALID_ON_CONFLICT.has(obj.onConflict)) {
		throw new Error('config.onConflict must be "overwrite" or "skip".');
	}

	if (typeof obj.postInstall !== 'string' || !VALID_POST_INSTALL.has(obj.postInstall)) {
		throw new Error('config.postInstall must be "all" or "none".');
	}

	if (obj.versions !== undefined && (typeof obj.versions !== 'string' || !VALID_VERSIONS.has(obj.versions))) {
		throw new Error('config.versions must be "pinned" or "latest" when present.');
	}

	if (obj.projectName !== undefined && typeof obj.projectName !== 'string') {
		throw new Error('config.projectName must be a string when present.');
	}

	return {
		units: obj.units as UnitId[],
		pm: obj.pm as Pm | null,
		onConflict: obj.onConflict as 'overwrite' | 'skip',
		postInstall: obj.postInstall as 'all' | 'none',
		versions: (obj.versions as 'pinned' | 'latest') ?? 'pinned',
		projectName: obj.projectName as string | undefined,
	};
}
