import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createJournal, formatRollbackReport, rollbackJournal } from './journal';

describe('createJournal', () => {
	let tmp: string;

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-journal-'));
	});

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	it('first-touch wins: a second record of the same path is a no-op', () => {
		const path = join(tmp, 'a.txt');
		writeFileSync(path, 'original\n');
		const journal = createJournal();

		journal.recordBefore(path);
		writeFileSync(path, 'changed by a unit\n');
		journal.recordBefore(path);

		expect(journal.entries()).toHaveLength(1);
		expect(journal.entries()[0]?.before?.toString()).toBe('original\n');
	});

	it('records before: null for a path that does not exist yet, and exact bytes for one that does', () => {
		const created = join(tmp, 'new.txt');
		const modified = join(tmp, 'existing.txt');
		writeFileSync(modified, 'existing content\n');
		const journal = createJournal();

		journal.recordBefore(created);
		journal.recordBefore(modified);

		const [createdEntry, modifiedEntry] = journal.entries();
		expect(createdEntry?.before).toBeNull();
		expect(modifiedEntry?.before?.toString()).toBe('existing content\n');
	});

	it('walks up from a nested path, recording only the ancestors that do not yet exist', () => {
		mkdirSync(join(tmp, 'a'));
		const path = join(tmp, 'a', 'b', 'c.txt');
		const journal = createJournal();

		journal.recordBefore(path);

		// `a` already existed, so only `a/b` is new.
		expect(journal.entries()[0]?.dirsCreated).toEqual([join(tmp, 'a', 'b')]);
	});
});

describe('rollbackJournal', () => {
	let tmp: string;

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-journal-'));
	});

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	it('restores modified files byte-exact, including binary content and CRLF/trailing whitespace', () => {
		const binaryPath = join(tmp, 'b.bin');
		const crlfPath = join(tmp, 'c.txt');
		const binaryBefore = Buffer.from([0xFF, 0xFE, 0x00, 0x01, 0x0D, 0x0A]);
		const crlfBefore = 'line one\r\nline two   \r\n';
		writeFileSync(binaryPath, binaryBefore);
		writeFileSync(crlfPath, crlfBefore);

		const journal = createJournal();
		journal.recordBefore(binaryPath);
		journal.recordBefore(crlfPath);

		writeFileSync(binaryPath, Buffer.from([0x01, 0x02]));
		writeFileSync(crlfPath, 'overwritten\n');

		const report = rollbackJournal(journal);

		expect(readFileSync(binaryPath)).toEqual(binaryBefore);
		expect(readFileSync(crlfPath, 'utf-8')).toBe(crlfBefore);
		expect(report.restored).toEqual(expect.arrayContaining([binaryPath, crlfPath]));
	});

	it('deletes files the run created', () => {
		const path = join(tmp, 'created.txt');
		const journal = createJournal();
		journal.recordBefore(path);
		writeFileSync(path, 'written by the run\n');

		const report = rollbackJournal(journal);

		expect(existsSync(path)).toBe(false);
		expect(report.deleted).toEqual([path]);
	});

	it('prunes run-created directories, leaving pre-existing ones and non-empty ones untouched', () => {
		// a/b are both new; a/b/c.txt is the only thing in them.
		const nestedPath = join(tmp, 'a', 'b', 'c.txt');
		// `existing-dir` is pre-existing and holds a created file—the directory
		// must survive even though the file inside it is rolled back.
		mkdirSync(join(tmp, 'existing-dir'));
		const inPreExistingDir = join(tmp, 'existing-dir', 'created.txt');
		// `crowded` is new but ends up holding an unrelated file the run didn't
		// journal, so it must survive too.
		const inCrowdedDir = join(tmp, 'crowded', 'journaled.txt');

		const journal = createJournal();
		journal.recordBefore(nestedPath);
		journal.recordBefore(inPreExistingDir);
		journal.recordBefore(inCrowdedDir);

		mkdirSync(join(tmp, 'a', 'b'), { recursive: true });
		writeFileSync(nestedPath, 'x\n');
		writeFileSync(inPreExistingDir, 'x\n');
		mkdirSync(join(tmp, 'crowded'), { recursive: true });
		writeFileSync(inCrowdedDir, 'x\n');
		writeFileSync(join(tmp, 'crowded', 'unrelated.txt'), 'left behind by something else\n');

		const report = rollbackJournal(journal);

		expect(existsSync(join(tmp, 'a'))).toBe(false);
		expect(existsSync(join(tmp, 'a', 'b'))).toBe(false);
		expect(report.prunedDirs).toEqual(expect.arrayContaining([join(tmp, 'a'), join(tmp, 'a', 'b')]));

		expect(existsSync(join(tmp, 'existing-dir'))).toBe(true);
		expect(report.prunedDirs).not.toContain(join(tmp, 'existing-dir'));

		expect(existsSync(join(tmp, 'crowded'))).toBe(true);
		expect(existsSync(join(tmp, 'crowded', 'unrelated.txt'))).toBe(true);
		expect(report.prunedDirs).not.toContain(join(tmp, 'crowded'));
	});

	it('leaves a never-journaled file untouched', () => {
		const skipped = join(tmp, 'skipped.txt');
		writeFileSync(skipped, 'user kept this on conflict\n');
		const journal = createJournal();

		const report = rollbackJournal(journal);

		expect(readFileSync(skipped, 'utf-8')).toBe('user kept this on conflict\n');
		expect(report.restored).not.toContain(skipped);
		expect(report.deleted).not.toContain(skipped);
	});

	it('collects a per-entry failure without aborting the rest of the rollback', () => {
		const okPath = join(tmp, 'ok.txt');
		const failPath = join(tmp, 'fail.txt');
		writeFileSync(okPath, 'ok before\n');
		writeFileSync(failPath, 'fail before\n');

		const journal = createJournal();
		journal.recordBefore(okPath);
		journal.recordBefore(failPath);

		writeFileSync(okPath, 'ok after\n');
		// Replace the journaled file with a non-empty directory so writeFileSync
		// throws (EISDIR) when rollback tries to restore it.
		rmSync(failPath, { force: true });
		mkdirSync(failPath);
		writeFileSync(join(failPath, 'blocking.txt'), 'in the way\n');

		const report = rollbackJournal(journal);

		expect(readFileSync(okPath, 'utf-8')).toBe('ok before\n');
		expect(report.restored).toEqual([okPath]);
		expect(report.failures).toHaveLength(1);
		expect(report.failures[0]?.path).toBe(failPath);
		expect(report.failures[0]?.message).toBeTruthy();
	});
});

describe('formatRollbackReport', () => {
	it('reports the summary counts and mentions node_modules', () => {
		const report = { restored: ['a', 'b'], deleted: ['c'], prunedDirs: [], failures: [] };
		const output = formatRollbackReport(report, '/target');

		expect(output).toBe('Rolled back: 2 file(s) restored, 1 created file(s) deleted.\n`node_modules` and the lockfile are untouched: the package manager owns those, and rollback does not reach them.');
	});

	it('lists a failure line relative to targetDir', () => {
		const report = {
			restored: [],
			deleted: [],
			prunedDirs: [],
			failures: [{ path: '/target/src/blocked.txt', message: 'EISDIR: illegal operation on a directory' }],
		};
		const output = formatRollbackReport(report, '/target');

		expect(output).toContain('  could not restore src/blocked.txt: EISDIR: illegal operation on a directory');
		expect(output.split('\n')).toEqual([
			'Rolled back: 0 file(s) restored, 0 created file(s) deleted.',
			'  could not restore src/blocked.txt: EISDIR: illegal operation on a directory',
			'`node_modules` and the lockfile are untouched: the package manager owns those, and rollback does not reach them.',
		]);
	});
});
