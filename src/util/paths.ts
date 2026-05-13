import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// Manifest entries write `src` paths relative to a known anchor so they don't
// have to know whether the CLI is running from src/ (tests, tsup --watch) or
// from a bundled dist/cli.js (publish, npx). PKG_ROOT is that anchor: the
// nearest package.json walking up from this file.
//
// Walk-up beats `resolve(import.meta.dirname, '..')` because the relative
// position differs between source and bundle — walking up to package.json
// works the same in both, including from inside node_modules/unbranded/.
//
// Engines field requires Node 24+, so import.meta.dirname is guaranteed.
function findPkgRoot(start: string): string {
	let dir = start;
	while (dir !== dirname(dir)) {
		if (existsSync(resolve(dir, 'package.json')))
			return dir;
		dir = dirname(dir);
	}
	throw new Error(`Could not locate package.json from ${start}`);
}

export const PKG_ROOT = findPkgRoot(import.meta.dirname);
