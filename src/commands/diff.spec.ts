import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildStateFile, hashBuffer } from '../state/state';
import { PKG_ROOT } from '../util/paths';
import { classify, computeDiff } from './diff';

describe('classify', () => {
	it('unchanged when disk and template both still match the record', () => {
		expect(classify({ recorded: 'h', onDisk: 'h', template: 'h' })).toBe('unchanged');
	});

	it('user-modified when the on-disk hash drifted from the record', () => {
		expect(classify({ recorded: 'h', onDisk: 'edited', template: 'h' })).toBe('user-modified');
	});

	it('template-updated when the template moved on but the file is untouched', () => {
		expect(classify({ recorded: 'h', onDisk: 'h', template: 'newer' })).toBe('template-updated');
	});

	it('both when the user edited a file the template also changed', () => {
		expect(classify({ recorded: 'h', onDisk: 'edited', template: 'newer' })).toBe('both');
	});

	it('treats a deleted file (no on-disk hash) as user-modified', () => {
		expect(classify({ recorded: 'h', onDisk: undefined, template: 'h' })).toBe('user-modified');
	});

	it('never flags template-updated when the template hash is unknown', () => {
		expect(classify({ recorded: 'h', onDisk: 'h', template: undefined })).toBe('unchanged');
	});
});

describe('computeDiff', () => {
	let tmp: string;
	// core-editorconfig ships .editorconfig as a plain copy with no interpolation,
	// so the template bytes are exactly what a clean scaffold would have written.
	const templatePath = join(PKG_ROOT, '.editorconfig');
	const template = readFileSync(templatePath);

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-diff-'));
	});

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	it('reports no drift when disk still matches what was recorded', () => {
		writeFileSync(join(tmp, '.editorconfig'), template);
		const state = buildStateFile({
			version: '1.0.0',
			units: ['core-editorconfig'],
			files: { '.editorconfig': hashBuffer(template) },
		});

		const report = computeDiff({ state, targetDir: tmp });
		expect(report.drift).toBe(false);
		expect(report.files.find(f => f.path === '.editorconfig')?.status).toBe('unchanged');
	});

	it('flags a user edit as user-modified and reports drift', () => {
		writeFileSync(join(tmp, '.editorconfig'), Buffer.concat([template, Buffer.from('\n# mine\n')]));
		const state = buildStateFile({
			version: '1.0.0',
			units: ['core-editorconfig'],
			files: { '.editorconfig': hashBuffer(template) },
		});

		const report = computeDiff({ state, targetDir: tmp });
		expect(report.drift).toBe(true);
		expect(report.files.find(f => f.path === '.editorconfig')?.status).toBe('user-modified');
	});

	it('flags a shipped-template change as template-updated when the file is untouched', () => {
		// The file on disk matches the record (user hasn't touched it), but the
		// record predates the current template, so the template hash has moved on.
		const scaffolded = Buffer.from('root = true\n');
		writeFileSync(join(tmp, '.editorconfig'), scaffolded);
		const state = buildStateFile({
			version: '0.0.1',
			units: ['core-editorconfig'],
			files: { '.editorconfig': hashBuffer(scaffolded) },
		});

		const report = computeDiff({ state, targetDir: tmp });
		expect(report.files.find(f => f.path === '.editorconfig')?.status).toBe('template-updated');
		expect(report.drift).toBe(true);
	});

	it('classifies a recorded file whose unit is gone using disk vs record alone', () => {
		// No known unit provides "mystery.txt", so there is no template to compare
		// against — classification falls back to the disk-vs-record axis only.
		writeFileSync(join(tmp, 'mystery.txt'), 'kept\n');
		const state = buildStateFile({
			version: '1.0.0',
			units: [],
			files: { 'mystery.txt': hashBuffer(Buffer.from('kept\n')) },
		});

		const report = computeDiff({ state, targetDir: tmp });
		expect(report.files[0]?.status).toBe('unchanged');
		expect(report.drift).toBe(false);
	});

	it('carries a renderable plan for a drifted file', () => {
		writeFileSync(join(tmp, '.editorconfig'), Buffer.concat([template, Buffer.from('\n# mine\n')]));
		const state = buildStateFile({
			version: '1.0.0',
			units: ['core-editorconfig'],
			files: { '.editorconfig': hashBuffer(template) },
		});

		const report = computeDiff({ state, targetDir: tmp });
		const entry = report.files.find(f => f.path === '.editorconfig');
		// planFileOp compares on-disk against the current template, which is the
		// patch `unbranded diff --diff` renders for a drifted file.
		expect(entry?.plan?.diff).toBeDefined();
	});
});
