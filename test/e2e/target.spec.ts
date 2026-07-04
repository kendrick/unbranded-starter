import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PKG_ROOT } from '../../src/util/paths';

const CLI = join(PKG_ROOT, 'dist/cli.js');

// --target scaffolds against another directory without cd-ing there first. The
// interesting property is that files land in the target while a relative --config
// path still resolves against the directory the command was invoked from.
describe('cli --target', () => {
	let work: string;

	beforeEach(() => {
		work = mkdtempSync(join(tmpdir(), 'unbranded-e2e-target-'));
		// The recipe lives in the invocation dir and is referenced by a relative
		// path; if --target changed how it resolved, this file wouldn't be found.
		writeFileSync(join(work, 'recipe.json'), JSON.stringify({
			units: ['core-editorconfig'],
			pm: null,
			onConflict: 'overwrite',
			postInstall: 'none',
		}));
		// An existing package.json makes the target an augment shape, so no name
		// prompt is needed and the run stays non-interactive.
		mkdirSync(join(work, 'app'));
		writeFileSync(join(work, 'app', 'package.json'), JSON.stringify({ name: 'app', version: '0.0.0' }));
	});

	afterEach(() => {
		rmSync(work, { recursive: true, force: true });
	});

	it('writes into the target dir, not the invocation cwd', () => {
		const result = spawnSync('node', [CLI, '--config', 'recipe.json', '--target', 'app'], {
			cwd: work,
			encoding: 'utf-8',
		});

		expect(result.status, `stderr: ${result.stderr}`).toBe(0);
		// core-editorconfig ships this file into the --target dir, not the cwd.
		expect(existsSync(join(work, 'app', '.editorconfig'))).toBe(true);
		// And nothing should have been scaffolded into the invocation cwd.
		expect(existsSync(join(work, '.editorconfig'))).toBe(false);
	});
});
