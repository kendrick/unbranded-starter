import type { TrackedWrite } from './state';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { baselinePath, builtinUnits, writeStateFile } from './state';

// Windows' `relative()` hands back `\`-separated rels, and that's what broke the
// baseline writer on windows-latest while every posix run stayed green (PR #201).
// Swapping in all of path.win32 would point fs calls at `\var\...` on macOS, so only
// the separator and `relative()` go native-Windows here; join/dirname stay real, and
// the test still writes and reads a real tree. On Windows the mock changes nothing.
vi.mock('node:path', async (importOriginal) => {
	const actual = await importOriginal<typeof import('node:path')>();
	const relative = (from: string, to: string) => actual.relative(from, to).split('/').join('\\');
	const overrides = { sep: '\\', relative };
	return { ...actual, ...overrides, default: { ...actual, ...overrides } };
});

describe('baseline sidecar under Windows path separators', () => {
	let tmp: string;

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-state-win32-'));
	});

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	function write(dest: string): TrackedWrite {
		return { dest: join(tmp, dest), unit: 'core-eslint', mode: 'copy' };
	}

	it('encodes a native-separator rel the same as its posix form', () => {
		expect(baselinePath(tmp, 'src\\x.ts')).toBe(baselinePath(tmp, 'src/x.ts'));
	});

	it('writes a nested baseline where readers and the prune look for it', () => {
		mkdirSync(join(tmp, 'src'));
		writeFileSync(join(tmp, 'src', 'x.ts'), 'x\n');
		writeStateFile({
			targetDir: tmp,
			units: builtinUnits(['core-eslint']),
			writes: [write('src/x.ts')],
		});

		const baselineDir = join(tmp, '.unbranded', 'baseline');
		expect(readFileSync(join(baselineDir, 'src.base', 'x.ts.base'), 'utf-8')).toBe('x\n');
		expect(readdirSync(baselineDir, { recursive: true }).sort()).toEqual([
			'src.base',
			join('src.base', 'x.ts.base'),
		]);
	});

	it('keeps a nested baseline through a later run that only rewrites another file', () => {
		mkdirSync(join(tmp, 'src'));
		writeFileSync(join(tmp, 'src', 'x.ts'), 'x\n');
		writeStateFile({
			targetDir: tmp,
			units: builtinUnits(['core-eslint']),
			writes: [write('src/x.ts')],
		});
		writeFileSync(join(tmp, 'a.txt'), 'alpha\n');
		writeStateFile({
			targetDir: tmp,
			units: builtinUnits(['core-eslint']),
			writes: [write('a.txt')],
		});

		const baselineDir = join(tmp, '.unbranded', 'baseline');
		expect(readFileSync(join(baselineDir, 'src.base', 'x.ts.base'), 'utf-8')).toBe('x\n');
		expect(readFileSync(join(baselineDir, 'a.txt.base'), 'utf-8')).toBe('alpha\n');
	});
});
