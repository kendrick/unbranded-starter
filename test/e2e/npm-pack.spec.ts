import { describe, expect, it } from 'vitest';
import { parsePackedFilePaths } from './npm-pack';

const FILES = [{ path: 'dist/cli.js' }, { path: 'README.md' }];

// npm <=11: `npm pack --json` returns an array of pack records.
const ARRAY_FORM = JSON.stringify([{ id: 'unbranded@1.0.0', files: FILES, entryCount: 2 }]);
// npm 12: the same payload became a bare object keyed by package name.
const OBJECT_FORM = JSON.stringify({ unbranded: { id: 'unbranded@1.0.0', files: FILES, entryCount: 2 } });
// Some npm builds run the `prepare` hook during pack and print ahead of the JSON.
const HOOK_NOISE = '> unbranded@1.0.0 prepare\n> simple-git-hooks\n[INFO] hooks configured\n';

describe('parsePackedFilePaths', () => {
	it('reads paths from the npm <=11 array form', () => {
		expect(parsePackedFilePaths(ARRAY_FORM)).toEqual(['dist/cli.js', 'README.md']);
	});

	it('reads paths from the npm 12 object form keyed by package name', () => {
		// Regression guard for the botched 1.0.0 publish: npm 12 changed the pack
		// --json shape from `[{...}]` to `{ "<pkg>": {...} }`, and the old helper
		// grabbed the inner `files` array and choked on the trailing fields.
		expect(parsePackedFilePaths(OBJECT_FORM)).toEqual(['dist/cli.js', 'README.md']);
	});

	it('ignores prepare-hook output printed ahead of the array form', () => {
		expect(parsePackedFilePaths(HOOK_NOISE + ARRAY_FORM)).toEqual(['dist/cli.js', 'README.md']);
	});

	it('ignores prepare-hook output printed ahead of the object form', () => {
		expect(parsePackedFilePaths(HOOK_NOISE + OBJECT_FORM)).toEqual(['dist/cli.js', 'README.md']);
	});

	it('ignores a warning printed after the JSON', () => {
		const trailing = '\nnpm warn Unknown user config "always-auth".\n';
		expect(parsePackedFilePaths(OBJECT_FORM + trailing)).toEqual(['dist/cli.js', 'README.md']);
	});
});
