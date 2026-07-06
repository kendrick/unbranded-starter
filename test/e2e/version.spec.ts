import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PKG_ROOT } from '../../src/util/paths';
import { packedFilePaths } from './npm-pack';

const CLI = join(PKG_ROOT, 'dist/cli.js');

function repoVersion(): string {
	const pkg = JSON.parse(readFileSync(join(PKG_ROOT, 'package.json'), 'utf-8')) as { version: string };
	return pkg.version;
}

describe('cli --version stays in sync with package.json', () => {
	it('prints the version it reads from package.json at runtime', () => {
		const result = spawnSync('node', [CLI, '--version'], { cwd: PKG_ROOT, encoding: 'utf-8' });
		expect(result.status, `stderr: ${result.stderr}`).toBe(0);
		expect(result.stdout.trim()).toBe(repoVersion());
	});

	it('ships the files that runtime read depends on', () => {
		// `--version` reads package.json from the package root at runtime (see
		// src/util/paths.ts), so it only survives publish if the tarball actually
		// contains package.json and the built entry. A dropped `files` entry
		// would break the published binary while the repo still passed — asserting
		// the pack manifest is the only thing that catches that before the
		// registry does.
		const packed = packedFilePaths();
		expect(packed).toContain('package.json');
		expect(packed).toContain('dist/cli.js');
	});
});
