import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PKG_ROOT } from '../../src/util/paths';
import { packedFilePaths } from './npm-pack';

describe('npm pack snapshot', () => {
	it('tarball contents match the committed snapshot', () => {
		// Catches both accidental additions (src/ leaking in, an .env file
		// slipping into files[]) and accidental removals (forgetting to add
		// a new template to files[]). When this fails legitimately, the fix
		// is one line: rewrite test/fixtures/expected-pack.txt with the new
		// `npm pack --dry-run --json` output, sorted.
		const actual = packedFilePaths().sort();

		const expected = readFileSync(join(PKG_ROOT, 'test/fixtures/expected-pack.txt'), 'utf-8')
			.trim()
			.split('\n');

		expect(actual).toEqual(expected);
	});
});
