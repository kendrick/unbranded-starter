import type { PackageJson } from '../util/package-json';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// Read-only repo probes shared by `doctor` (which reports what's missing) and the
// installed-unit detector (which reports what's already there). Both ask the same
// low-level questions of a package.json and the filesystem, so the questions live
// in one place rather than being answered twice with drift between them.

// Narrow an unknown to a plain object. A hand-edited package.json can put an array
// or null where a map belongs, so every probe funnels through this rather than
// trusting the field's declared type.
function record(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

export function hasDep(pkg: PackageJson, name: string): boolean {
	return Boolean(record(pkg.dependencies)?.[name]) || Boolean(record(pkg.devDependencies)?.[name]);
}

export function hasScript(pkg: PackageJson, name: string): boolean {
	const scripts = record(pkg.scripts);
	return typeof scripts?.[name] === 'string';
}

export function engines(pkg: PackageJson): Record<string, unknown> | undefined {
	return record(pkg.engines);
}

// Any one of the three pins counts: engines.node, an .nvmrc, or a Corepack
// packageManager field. core-node-version writes all three, so presence of any is
// a good-enough signal that the pin is handled.
export function hasNodeVersionPin(cwd: string, pkg: PackageJson): boolean {
	return Boolean(engines(pkg)?.node) || existsSync(join(cwd, '.nvmrc')) || typeof pkg.packageManager === 'string';
}

// The path a FileOp actually lands at: `rename` swaps the basename while keeping
// dest's directory (npm strips a leading-dot template name, so we ship it renamed).
// Widened from the catalog's file type to a bare `{ dest; rename? }` so the raw
// manifest FileOp works here too.
export function effectiveDest(file: { dest: string; rename?: string }): string {
	if (!file.rename)
		return file.dest;
	const slash = file.dest.lastIndexOf('/');
	return slash === -1 ? file.rename : `${file.dest.slice(0, slash)}/${file.rename}`;
}
