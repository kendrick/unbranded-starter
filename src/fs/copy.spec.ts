import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { copyFileOp } from './copy';

describe('copyFileOp', () => {
	let pkgRoot: string;
	let targetDir: string;

	beforeEach(() => {
		pkgRoot = mkdtempSync(join(tmpdir(), 'unbranded-copy-pkg-'));
		targetDir = mkdtempSync(join(tmpdir(), 'unbranded-copy-target-'));
	});

	afterEach(() => {
		rmSync(pkgRoot, { recursive: true, force: true });
		rmSync(targetDir, { recursive: true, force: true });
	});

	it('copies a file when the destination does not exist', async () => {
		writeFileSync(join(pkgRoot, 'eslint.config.mjs'), 'export default {}\n');
		const result = await copyFileOp(
			{ src: 'eslint.config.mjs', dest: 'eslint.config.mjs' },
			{ pkgRoot, targetDir },
		);
		expect(result.action).toBe('copied');
		expect(readFileSync(join(targetDir, 'eslint.config.mjs'), 'utf-8')).toBe('export default {}\n');
	});

	it('skips when source and dest are byte-identical', async () => {
		writeFileSync(join(pkgRoot, 'a.txt'), 'same\n');
		writeFileSync(join(targetDir, 'a.txt'), 'same\n');
		const result = await copyFileOp(
			{ src: 'a.txt', dest: 'a.txt' },
			{ pkgRoot, targetDir },
		);
		expect(result).toMatchObject({ action: 'skipped', reason: 'identical' });
	});

	it('overwrites when onConflict is "overwrite"', async () => {
		writeFileSync(join(pkgRoot, 'a.txt'), 'new\n');
		writeFileSync(join(targetDir, 'a.txt'), 'old\n');
		const result = await copyFileOp(
			{ src: 'a.txt', dest: 'a.txt' },
			{ pkgRoot, targetDir, onConflict: 'overwrite' },
		);
		expect(result.action).toBe('overwrote');
		expect(readFileSync(join(targetDir, 'a.txt'), 'utf-8')).toBe('new\n');
	});

	it('skips with reason "user-skip" when onConflict is "skip"', async () => {
		writeFileSync(join(pkgRoot, 'a.txt'), 'new\n');
		writeFileSync(join(targetDir, 'a.txt'), 'old\n');
		const result = await copyFileOp(
			{ src: 'a.txt', dest: 'a.txt' },
			{ pkgRoot, targetDir, onConflict: 'skip' },
		);
		expect(result).toMatchObject({ action: 'skipped', reason: 'user-skip' });
		expect(readFileSync(join(targetDir, 'a.txt'), 'utf-8')).toBe('old\n');
	});

	it('substitutes {projectName} into dest', async () => {
		writeFileSync(join(pkgRoot, 'app.json'), '{}');
		const result = await copyFileOp(
			{ src: 'app.json', dest: '{projectName}/app.json' },
			{ pkgRoot, targetDir, projectName: 'acme' },
		);
		expect(result.action).toBe('copied');
		expect(existsSync(join(targetDir, 'acme', 'app.json'))).toBe(true);
	});

	it('uses `rename` to swap just the basename, keeping the directory', async () => {
		writeFileSync(join(pkgRoot, 'gitignore.template'), 'node_modules\n');
		const result = await copyFileOp(
			{ src: 'gitignore.template', dest: 'sub/gitignore.template', rename: '.gitignore' },
			{ pkgRoot, targetDir },
		);
		expect(result.action).toBe('copied');
		expect(existsSync(join(targetDir, 'sub', '.gitignore'))).toBe(true);
		expect(existsSync(join(targetDir, 'sub', 'gitignore.template'))).toBe(false);
	});

	it('preserves binary content byte-for-byte (no encoding round-trip)', async () => {
		const bytes = Buffer.from([0xFF, 0xFE, 0x00, 0x01, 0x0D, 0x0A]);
		writeFileSync(join(pkgRoot, 'b.bin'), bytes);
		await copyFileOp(
			{ src: 'b.bin', dest: 'b.bin' },
			{ pkgRoot, targetDir },
		);
		expect(readFileSync(join(targetDir, 'b.bin'))).toEqual(bytes);
	});

	it('creates intermediate directories on the way to dest', async () => {
		writeFileSync(join(pkgRoot, 'cn.ts'), 'export const cn = () => {}\n');
		const result = await copyFileOp(
			{ src: 'cn.ts', dest: 'src/lib/utils/cn.ts' },
			{ pkgRoot, targetDir },
		);
		expect(result.action).toBe('copied');
		expect(existsSync(join(targetDir, 'src', 'lib', 'utils', 'cn.ts'))).toBe(true);
	});

	it('joins posix-style src segments correctly', async () => {
		mkdirSync(join(pkgRoot, 'opt-in', 'playwright'), { recursive: true });
		writeFileSync(join(pkgRoot, 'opt-in', 'playwright', 'playwright.config.ts'), 'export default {}\n');
		const result = await copyFileOp(
			{ src: 'opt-in/playwright/playwright.config.ts', dest: 'playwright.config.ts' },
			{ pkgRoot, targetDir },
		);
		expect(result.action).toBe('copied');
	});
});
