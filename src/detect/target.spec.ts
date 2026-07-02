import type { Mock } from 'vitest';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { confirm, isCancel, text } from '@clack/prompts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { classifyExistingDir, detectTarget, inspectTarget, validateProjectName } from './target';

// The async shell (detectTarget) prompts through clack. Mock the module so we
// can drive the text and confirm answers directly; the pure halves below run
// without touching it, per the pure-core/async-shell split.
vi.mock('@clack/prompts', () => ({
	text: vi.fn(),
	confirm: vi.fn(),
	isCancel: vi.fn(() => false),
	cancel: vi.fn(),
}));

describe('inspectTarget', () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), 'unbranded-target-'));
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it('returns "new" mode when the directory has no package.json', () => {
		const result = inspectTarget(dir);
		expect(result).toEqual({ kind: 'new', parent: dir });
	});

	it('returns "augment" mode when the directory has a package.json', () => {
		writeFileSync(join(dir, 'package.json'), '{}');
		const result = inspectTarget(dir);
		expect(result).toEqual({ kind: 'augment', dir });
	});

	it('detects this repo as an augment target (sanity)', () => {
		// vitest runs from the package root, which always has package.json.
		const result = inspectTarget(process.cwd());
		expect(result.kind).toBe('augment');
	});
});

describe('validateProjectName', () => {
	it('accepts "." as the in-place sentinel', () => {
		expect(validateProjectName('.')).toBeUndefined();
	});

	it('accepts a conventional name', () => {
		expect(validateProjectName('my-app')).toBeUndefined();
	});

	it('rejects an empty name', () => {
		expect(validateProjectName('')).toBe('Required');
	});

	it('rejects uppercase and illegal characters', () => {
		expect(validateProjectName('MyApp')).toMatch(/Lowercase/);
		expect(validateProjectName('bad name')).toMatch(/Lowercase/);
	});

	it('rejects a name past npm\'s 214-char cap', () => {
		expect(validateProjectName('a'.repeat(215))).toMatch(/Too long/);
	});
});

describe('classifyExistingDir', () => {
	it('classifies an empty directory as empty', () => {
		expect(classifyExistingDir([])).toBe('empty');
	});

	it('classifies clone residue (.git, README, LICENSE, .gitignore) as safe', () => {
		expect(classifyExistingDir(['.git'])).toBe('safe');
		expect(classifyExistingDir(['.git', 'README.md', 'LICENSE', '.gitignore'])).toBe('safe');
	});

	it('classifies anything outside the safe set as unsafe', () => {
		expect(classifyExistingDir(['.git', 'src'])).toBe('unsafe');
		expect(classifyExistingDir(['package.json'])).toBe('unsafe');
	});
});

describe('detectTarget (new-project shell)', () => {
	let tmp: string;
	let cwd: string;
	let origCwd: string;

	beforeEach(() => {
		vi.clearAllMocks();
		(isCancel as unknown as Mock).mockReturnValue(false);
		origCwd = process.cwd();
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-detect-'));
		process.chdir(tmp);
		// process.cwd() may resolve symlinks (e.g. /var -> /private/var on macOS),
		// so anchor expectations to the resolved value rather than `tmp`.
		cwd = process.cwd();
	});

	afterEach(() => {
		process.chdir(origCwd);
		rmSync(tmp, { recursive: true, force: true });
	});

	it('projectName "." uses cwd and skips mkdir/chdir', async () => {
		const result = await detectTarget({ projectName: '.' });

		expect(result).toEqual({ dir: cwd, mode: 'new' });
		// No subdirectory was created and we never left cwd.
		expect(readdirSync(cwd)).toEqual([]);
		expect(process.cwd()).toBe(cwd);
	});

	it('scaffolds into a clone-shaped named directory after one confirm', async () => {
		mkdirSync(join(cwd, 'proj', '.git'), { recursive: true });
		writeFileSync(join(cwd, 'proj', 'README.md'), '# proj\n');
		(text as unknown as Mock).mockResolvedValue('proj');
		(confirm as unknown as Mock).mockResolvedValue(true);

		const result = await detectTarget();

		expect(confirm).toHaveBeenCalledTimes(1);
		expect(result).toEqual({ dir: join(cwd, 'proj'), mode: 'new' });
		expect(process.cwd()).toBe(join(cwd, 'proj'));
	});

	it('exits 130 via cancelAndExit when the confirm is cancelled', async () => {
		mkdirSync(join(cwd, 'proj'));
		(text as unknown as Mock).mockResolvedValue('proj');
		(confirm as unknown as Mock).mockResolvedValue(Symbol('cancel'));
		(isCancel as unknown as Mock).mockReturnValue(true);
		const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

		await detectTarget();

		expect(exit).toHaveBeenCalledWith(130);
		exit.mockRestore();
	});

	it('hard-refuses a named directory holding non-safe files', async () => {
		mkdirSync(join(cwd, 'proj'));
		writeFileSync(join(cwd, 'proj', 'main.py'), 'print()\n');

		// Config-mode path (projectName supplied) so the refusal is a throw, not
		// a prompt — the never-clobber default holds without a package manager.
		await expect(detectTarget({ projectName: 'proj' })).rejects.toThrow(/already exists/);
	});

	it('steers detection with the cwd option (for --target), never leaving process.cwd()', async () => {
		// A directory the process is NOT chdir'd into: --target points here.
		const other = mkdtempSync(join(tmpdir(), 'unbranded-target-opt-'));
		writeFileSync(join(other, 'package.json'), '{}');
		try {
			const result = await detectTarget({ cwd: other });
			// Augmented the --target dir, not the cwd we're sitting in.
			expect(result).toEqual({ dir: other, mode: 'augment' });
			expect(process.cwd()).toBe(cwd);
		}
		finally {
			rmSync(other, { recursive: true, force: true });
		}
	});
});
