import { describe, expect, it } from 'vitest';
import { parsePackedFilePaths } from './npm-pack';

const CLEAN = JSON.stringify([{ files: [{ path: 'dist/cli.js' }, { path: 'README.md' }] }]);

describe('parsePackedFilePaths', () => {
	it('reads file paths from clean npm pack --json output', () => {
		expect(parsePackedFilePaths(CLEAN)).toEqual(['dist/cli.js', 'README.md']);
	});

	it('ignores prepare-hook output printed ahead of the JSON', () => {
		// node's bundled npm runs `prepare` during pack even with --ignore-scripts,
		// printing hook lines before the payload. The `[INFO]`-style lines never
		// form `[` + `{`, so the array search skips past them.
		const withLeadingHook = `> unbranded@1.0.0 prepare\n> simple-git-hooks\n[INFO] hooks configured\n${CLEAN}`;
		expect(parsePackedFilePaths(withLeadingHook)).toEqual(['dist/cli.js', 'README.md']);
	});

	it('ignores an npm warning printed after the JSON', () => {
		// Regression guard for the failed 1.0.0 publish: the publish job installs
		// npm@latest, which warns on setup-node's always-auth .npmrc entry. That
		// notice lands after the JSON on stdout and used to break JSON.parse.
		const withTrailingWarn = `${CLEAN}\nnpm warn Unknown user config "always-auth". This will stop working in the next major version of npm.\n`;
		expect(parsePackedFilePaths(withTrailingWarn)).toEqual(['dist/cli.js', 'README.md']);
	});
});
