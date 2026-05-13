import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PKG_ROOT } from '../../src/util/paths';

interface PackOutput {
	files: { path: string }[];
}

describe('npm pack snapshot', () => {
	it('tarball contents match the committed snapshot', () => {
		// Catches both accidental additions (src/ leaking in, an .env file
		// slipping into files[]) and accidental removals (forgetting to add
		// a new template to files[]). When this fails legitimately, the fix
		// is one line: rewrite test/fixtures/expected-pack.txt with the new
		// `npm pack --dry-run --json` output, sorted.
		const stdout = execSync('npm pack --dry-run --json', { cwd: PKG_ROOT, encoding: 'utf-8' });
		const parsed = JSON.parse(stdout) as PackOutput[];
		const first = parsed[0];
		if (!first)
			throw new Error('npm pack returned no entries');
		const actual = first.files.map(f => f.path).sort();

		const expected = readFileSync(join(PKG_ROOT, 'test/fixtures/expected-pack.txt'), 'utf-8')
			.trim()
			.split('\n');

		expect(actual).toEqual(expected);
	});
});
