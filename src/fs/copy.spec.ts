import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { select } from '@clack/prompts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { copyFileOp, planFileOp } from './copy';

// The merge-json conflict fallback re-uses the raw-copy `select` prompt. Stub
// just that export so we can assert the interactive path fires without a TTY;
// everything else (isCancel, log) stays real so the non-interactive tests are
// unaffected.
vi.mock('@clack/prompts', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@clack/prompts')>();
	return { ...actual, select: vi.fn() };
});

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

describe('copyFileOp mode: merge-json', () => {
	let pkgRoot: string;
	let targetDir: string;

	beforeEach(() => {
		pkgRoot = mkdtempSync(join(tmpdir(), 'unbranded-merge-pkg-'));
		targetDir = mkdtempSync(join(tmpdir(), 'unbranded-merge-target-'));
		vi.mocked(select).mockReset();
	});

	afterEach(() => {
		rmSync(pkgRoot, { recursive: true, force: true });
		rmSync(targetDir, { recursive: true, force: true });
	});

	function readJson(path: string): Record<string, unknown> {
		return JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
	}

	it('copies the source verbatim when the destination does not exist', async () => {
		writeFileSync(join(pkgRoot, 'c.json'), '{ "a": 1 }');
		const result = await copyFileOp(
			{ src: 'c.json', dest: 'c.json', mode: 'merge-json' },
			{ pkgRoot, targetDir },
		);
		expect(result.action).toBe('copied');
		expect(readJson(join(targetDir, 'c.json'))).toEqual({ a: 1 });
	});

	it('deep-merges disjoint keys and reports "merged"', async () => {
		writeFileSync(join(pkgRoot, 'c.json'), JSON.stringify({ version: '1.0.0', settings: { b: 2 } }));
		writeFileSync(join(targetDir, 'c.json'), `${JSON.stringify({ name: 'app', settings: { a: 1 } }, null, 2)}\n`);
		const result = await copyFileOp(
			{ src: 'c.json', dest: 'c.json', mode: 'merge-json' },
			{ pkgRoot, targetDir },
		);
		expect(result.action).toBe('merged');
		expect(readJson(join(targetDir, 'c.json'))).toEqual({
			name: 'app',
			settings: { a: 1, b: 2 },
			version: '1.0.0',
		});
	});

	it('reports "skipped (identical)" when the incoming keys are already present', async () => {
		writeFileSync(join(pkgRoot, 'c.json'), JSON.stringify({ a: 1 }));
		writeFileSync(join(targetDir, 'c.json'), `${JSON.stringify({ name: 'app', a: 1 }, null, 2)}\n`);
		const result = await copyFileOp(
			{ src: 'c.json', dest: 'c.json', mode: 'merge-json' },
			{ pkgRoot, targetDir },
		);
		expect(result).toMatchObject({ action: 'skipped', reason: 'identical' });
	});

	it('is idempotent — a second merge run reports "skipped (identical)"', async () => {
		writeFileSync(join(pkgRoot, 'c.json'), JSON.stringify({ b: 2 }));
		writeFileSync(join(targetDir, 'c.json'), `${JSON.stringify({ a: 1 }, null, 2)}\n`);
		const first = await copyFileOp({ src: 'c.json', dest: 'c.json', mode: 'merge-json' }, { pkgRoot, targetDir });
		const second = await copyFileOp({ src: 'c.json', dest: 'c.json', mode: 'merge-json' }, { pkgRoot, targetDir });
		expect(first.action).toBe('merged');
		expect(second).toMatchObject({ action: 'skipped', reason: 'identical' });
	});

	it('resolves a same-key conflict via onConflict:"overwrite" (patch wins), no prompt', async () => {
		writeFileSync(join(pkgRoot, 'c.json'), JSON.stringify({ license: 'Apache-2.0' }));
		writeFileSync(join(targetDir, 'c.json'), `${JSON.stringify({ name: 'app', license: 'MIT' }, null, 2)}\n`);
		const result = await copyFileOp(
			{ src: 'c.json', dest: 'c.json', mode: 'merge-json' },
			{ pkgRoot, targetDir, onConflict: 'overwrite' },
		);
		expect(select).not.toHaveBeenCalled();
		expect(result.action).toBe('merged');
		expect(readJson(join(targetDir, 'c.json'))).toMatchObject({ name: 'app', license: 'Apache-2.0' });
	});

	it('resolves a same-key conflict via onConflict:"skip" (existing wins), no prompt', async () => {
		writeFileSync(join(pkgRoot, 'c.json'), JSON.stringify({ license: 'Apache-2.0' }));
		writeFileSync(join(targetDir, 'c.json'), `${JSON.stringify({ name: 'app', license: 'MIT' }, null, 2)}\n`);
		const result = await copyFileOp(
			{ src: 'c.json', dest: 'c.json', mode: 'merge-json' },
			{ pkgRoot, targetDir, onConflict: 'skip' },
		);
		expect(select).not.toHaveBeenCalled();
		expect(result).toMatchObject({ action: 'skipped', reason: 'user-skip' });
		expect(readJson(join(targetDir, 'c.json'))).toMatchObject({ license: 'MIT' });
	});

	it('falls back to the diff-and-prompt UX on a same-key conflict when no onConflict is set', async () => {
		vi.mocked(select).mockResolvedValueOnce('overwrite');
		writeFileSync(join(pkgRoot, 'c.json'), JSON.stringify({ license: 'Apache-2.0' }));
		writeFileSync(join(targetDir, 'c.json'), `${JSON.stringify({ name: 'app', license: 'MIT' }, null, 2)}\n`);
		const result = await copyFileOp(
			{ src: 'c.json', dest: 'c.json', mode: 'merge-json' },
			{ pkgRoot, targetDir },
		);
		expect(select).toHaveBeenCalledTimes(1);
		expect(result.action).toBe('merged');
		expect(readJson(join(targetDir, 'c.json'))).toMatchObject({ license: 'Apache-2.0' });
	});
});

describe('copyFileOp mode: append-if-missing', () => {
	let pkgRoot: string;
	let targetDir: string;

	beforeEach(() => {
		pkgRoot = mkdtempSync(join(tmpdir(), 'unbranded-append-pkg-'));
		targetDir = mkdtempSync(join(tmpdir(), 'unbranded-append-target-'));
	});

	afterEach(() => {
		rmSync(pkgRoot, { recursive: true, force: true });
		rmSync(targetDir, { recursive: true, force: true });
	});

	it('copies the source verbatim when the destination does not exist', async () => {
		writeFileSync(join(pkgRoot, '.gitignore'), 'node_modules\n');
		const result = await copyFileOp(
			{ src: '.gitignore', dest: '.gitignore', mode: 'append-if-missing' },
			{ pkgRoot, targetDir },
		);
		expect(result.action).toBe('copied');
		expect(readFileSync(join(targetDir, '.gitignore'), 'utf-8')).toBe('node_modules\n');
	});

	it('appends only the missing lines and preserves the trailing newline', async () => {
		writeFileSync(join(pkgRoot, '.gitignore'), 'node_modules\ndist\n');
		writeFileSync(join(targetDir, '.gitignore'), 'node_modules\n.env\n');
		const result = await copyFileOp(
			{ src: '.gitignore', dest: '.gitignore', mode: 'append-if-missing' },
			{ pkgRoot, targetDir },
		);
		expect(result.action).toBe('appended');
		expect(readFileSync(join(targetDir, '.gitignore'), 'utf-8')).toBe('node_modules\n.env\ndist\n');
	});

	it('is idempotent — a second run reports "skipped (identical)"', async () => {
		writeFileSync(join(pkgRoot, '.gitignore'), 'node_modules\ndist\n');
		writeFileSync(join(targetDir, '.gitignore'), 'node_modules\n.env\n');
		const first = await copyFileOp({ src: '.gitignore', dest: '.gitignore', mode: 'append-if-missing' }, { pkgRoot, targetDir });
		const second = await copyFileOp({ src: '.gitignore', dest: '.gitignore', mode: 'append-if-missing' }, { pkgRoot, targetDir });
		expect(first.action).toBe('appended');
		expect(second).toMatchObject({ action: 'skipped', reason: 'identical' });
	});
});

describe('planFileOp (dry-run classification)', () => {
	let pkgRoot: string;
	let targetDir: string;

	beforeEach(() => {
		pkgRoot = mkdtempSync(join(tmpdir(), 'unbranded-plan-pkg-'));
		targetDir = mkdtempSync(join(tmpdir(), 'unbranded-plan-target-'));
	});

	afterEach(() => {
		rmSync(pkgRoot, { recursive: true, force: true });
		rmSync(targetDir, { recursive: true, force: true });
	});

	it('reports "create" for a destination that does not exist, and writes nothing', () => {
		writeFileSync(join(pkgRoot, 'a.txt'), 'hello\n');
		const plan = planFileOp({ src: 'a.txt', dest: 'a.txt' }, { pkgRoot, targetDir });
		expect(plan.outcome).toBe('create');
		expect(existsSync(join(targetDir, 'a.txt'))).toBe(false);
	});

	it('reports "skip" when source and dest are byte-identical', () => {
		writeFileSync(join(pkgRoot, 'a.txt'), 'same\n');
		writeFileSync(join(targetDir, 'a.txt'), 'same\n');
		expect(planFileOp({ src: 'a.txt', dest: 'a.txt' }, { pkgRoot, targetDir }).outcome).toBe('skip');
	});

	it('reports "conflict" for a differing raw-copy file, with a dest-relative path and no write', () => {
		writeFileSync(join(pkgRoot, 'a.txt'), 'new\n');
		mkdirSync(join(targetDir, 'sub'), { recursive: true });
		writeFileSync(join(targetDir, 'sub', 'a.txt'), 'old\n');
		const plan = planFileOp({ src: 'a.txt', dest: 'sub/a.txt' }, { pkgRoot, targetDir });
		expect(plan.outcome).toBe('conflict');
		expect(plan.rel).toBe(join('sub', 'a.txt'));
		expect(plan.diff).toBeDefined();
		// The plan must not touch the file it's describing.
		expect(readFileSync(join(targetDir, 'sub', 'a.txt'), 'utf-8')).toBe('old\n');
	});

	it('reports "merge" for a clean merge-json overlay', () => {
		writeFileSync(join(pkgRoot, 'c.json'), JSON.stringify({ b: 2 }));
		writeFileSync(join(targetDir, 'c.json'), `${JSON.stringify({ a: 1 }, null, 2)}\n`);
		const plan = planFileOp({ src: 'c.json', dest: 'c.json', mode: 'merge-json' }, { pkgRoot, targetDir });
		expect(plan.outcome).toBe('merge');
		expect(readFileSync(join(targetDir, 'c.json'), 'utf-8')).toBe(`${JSON.stringify({ a: 1 }, null, 2)}\n`);
	});

	it('reports "skip" for a merge-json overlay that adds nothing', () => {
		writeFileSync(join(pkgRoot, 'c.json'), JSON.stringify({ a: 1 }));
		writeFileSync(join(targetDir, 'c.json'), `${JSON.stringify({ a: 1, name: 'x' }, null, 2)}\n`);
		expect(planFileOp({ src: 'c.json', dest: 'c.json', mode: 'merge-json' }, { pkgRoot, targetDir }).outcome).toBe('skip');
	});

	it('reports "conflict" for a merge-json same-key collision', () => {
		writeFileSync(join(pkgRoot, 'c.json'), JSON.stringify({ license: 'Apache-2.0' }));
		writeFileSync(join(targetDir, 'c.json'), `${JSON.stringify({ license: 'MIT' }, null, 2)}\n`);
		expect(planFileOp({ src: 'c.json', dest: 'c.json', mode: 'merge-json' }, { pkgRoot, targetDir }).outcome).toBe('conflict');
	});

	it('reports "append" when append-if-missing would add lines, and "skip" once they exist', () => {
		writeFileSync(join(pkgRoot, '.gitignore'), 'node_modules\ndist\n');
		writeFileSync(join(targetDir, '.gitignore'), 'node_modules\n');
		const plan = planFileOp({ src: '.gitignore', dest: '.gitignore', mode: 'append-if-missing' }, { pkgRoot, targetDir });
		expect(plan.outcome).toBe('append');
		// Nothing written by planning.
		expect(readFileSync(join(targetDir, '.gitignore'), 'utf-8')).toBe('node_modules\n');

		writeFileSync(join(targetDir, '.gitignore'), 'node_modules\ndist\n');
		expect(planFileOp({ src: '.gitignore', dest: '.gitignore', mode: 'append-if-missing' }, { pkgRoot, targetDir }).outcome).toBe('skip');
	});
});
