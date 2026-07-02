import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { copyFileOp } from '../../src/fs/copy';
import { PKG_ROOT } from '../../src/util/paths';

// Proves `mode` is no longer a dead field: each committed fixture (a source
// template plus a target file) drives the real dispatch in copyFileOp end to
// end. The target is copied into a scratch dir first so the checked-in fixtures
// stay pristine across runs.
const FIXTURES = join(PKG_ROOT, 'test/fixtures/fileop-modes');

describe('fileOp mode dispatch (committed fixtures)', () => {
	let targetDir: string;

	beforeEach(() => {
		targetDir = mkdtempSync(join(tmpdir(), 'unbranded-e2e-modes-'));
	});

	afterEach(() => {
		rmSync(targetDir, { recursive: true, force: true });
	});

	it('merge-json folds the template into the existing file', async () => {
		const modeDir = join(FIXTURES, 'merge-json');
		cpSync(join(modeDir, 'target', 'settings.json'), join(targetDir, 'settings.json'));

		const result = await copyFileOp(
			{ src: 'source/settings.json', dest: 'settings.json', mode: 'merge-json' },
			{ pkgRoot: modeDir, targetDir },
		);

		expect(result.action).toBe('merged');
		expect(JSON.parse(readFileSync(join(targetDir, 'settings.json'), 'utf-8'))).toEqual({
			editor: { tabSize: 2, formatOnSave: true },
			theme: 'dark',
			telemetry: false,
		});
	});

	it('append-if-missing grafts new lines and is idempotent on a rerun', async () => {
		const modeDir = join(FIXTURES, 'append-if-missing');
		cpSync(join(modeDir, 'target', 'gitignore'), join(targetDir, '.gitignore'));

		const op = { src: 'source/gitignore.template', dest: '.gitignore', mode: 'append-if-missing' } as const;

		const first = await copyFileOp(op, { pkgRoot: modeDir, targetDir });
		expect(first.action).toBe('appended');
		expect(readFileSync(join(targetDir, '.gitignore'), 'utf-8')).toBe('node_modules\ncoverage\ndist\n.env\n');

		const second = await copyFileOp(op, { pkgRoot: modeDir, targetDir });
		expect(second).toMatchObject({ action: 'skipped', reason: 'identical' });
	});
});
