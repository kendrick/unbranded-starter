import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { planFileOp, readSource } from '../fs/copy';
import { UNITS } from '../manifest/index';
import { applyUnitOptions } from '../manifest/options';
import { buildVscodeSettings } from '../manifest/vscode-settings';
import { buildStateFile, builtinUnits, hashBuffer } from '../state/state';
import { PKG_ROOT } from '../util/paths';
import { classify, computeDiff, runDiff } from './diff';

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
		expect(classify({ recorded: 'h', template: 'h' })).toBe('user-modified');
	});

	it('never flags template-updated when the template hash is unknown', () => {
		expect(classify({ recorded: 'h', onDisk: 'h' })).toBe('unchanged');
	});

	it('lets an explicit templateUpdated verdict win over the hash comparison', () => {
		expect(
			classify({ recorded: 'h', onDisk: 'h', template: 'newer', templateUpdated: false }),
		).toBe('unchanged');
		expect(classify({ recorded: 'h', onDisk: 'edited', templateUpdated: true })).toBe('both');
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
			units: builtinUnits(['core-editorconfig']),
			files: { '.editorconfig': hashBuffer(template) },
		});

		const report = computeDiff({ state, targetDir: tmp });
		expect(report.drift).toBe(false);
		expect(report.files.find((f) => f.path === '.editorconfig')?.status).toBe('unchanged');
	});

	it('flags a user edit as user-modified and reports drift', () => {
		writeFileSync(join(tmp, '.editorconfig'), Buffer.concat([template, Buffer.from('\n# mine\n')]));
		const state = buildStateFile({
			version: '1.0.0',
			units: builtinUnits(['core-editorconfig']),
			files: { '.editorconfig': hashBuffer(template) },
		});

		const report = computeDiff({ state, targetDir: tmp });
		expect(report.drift).toBe(true);
		expect(report.files.find((f) => f.path === '.editorconfig')?.status).toBe('user-modified');
	});

	it('flags a shipped-template change as template-updated when the file is untouched', () => {
		// The file on disk matches the record (user hasn't touched it), but the
		// record predates the current template, so the template hash has moved on.
		const scaffolded = Buffer.from('root = true\n');
		writeFileSync(join(tmp, '.editorconfig'), scaffolded);
		const state = buildStateFile({
			version: '0.0.1',
			units: builtinUnits(['core-editorconfig']),
			files: { '.editorconfig': hashBuffer(scaffolded) },
		});

		const report = computeDiff({ state, targetDir: tmp });
		expect(report.files.find((f) => f.path === '.editorconfig')?.status).toBe('template-updated');
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
			units: builtinUnits(['core-editorconfig']),
			files: { '.editorconfig': hashBuffer(template) },
		});

		const report = computeDiff({ state, targetDir: tmp });
		const entry = report.files.find((f) => f.path === '.editorconfig');
		// planFileOp compares on-disk against the current template, which is the
		// patch `unbranded diff --diff` renders for a drifted file.
		expect(entry?.plan?.diff).toBeDefined();
	});
});

describe('computeDiff on a merge-json file merged into an existing one (#227)', () => {
	let tmp: string;
	const SETTINGS = '.vscode/settings.json';

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-diff-merge-'));
		mkdirSync(join(tmp, '.vscode'));
	});

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	// Writes `settings` as the on-disk file and records its own hash, as a scaffold
	// that merged into an existing file does: the record is the merge result, not
	// the template's bytes.
	function statusOf(
		settings: Record<string, unknown>,
		units: string[],
		recordedSettings: Record<string, unknown> = settings,
	): string | undefined {
		writeFileSync(join(tmp, SETTINGS), `${JSON.stringify(settings, null, '\t')}\n`);
		const recorded = Buffer.from(`${JSON.stringify(recordedSettings, null, '\t')}\n`);
		const state = buildStateFile({
			version: '1.0.0',
			units: builtinUnits(units),
			files: { [SETTINGS]: hashBuffer(recorded) },
		});
		return computeDiff({ state, targetDir: tmp }).files.find((f) => f.path === SETTINGS)?.status;
	}

	const generated = (...ids: string[]): Record<string, unknown> =>
		JSON.parse(buildVscodeSettings(new Set(ids)).content) as Record<string, unknown>;

	it('reads unchanged when the template adds nothing the file lacks', () => {
		expect(statusOf({ 'editor.tabSize': 4, ...generated() }, ['opt-vscode'])).toBe('unchanged');
	});

	it('reads template-updated when the template sets a key the file lacks', () => {
		const { 'editor.formatOnSave': _, ...rest } = generated();
		expect(statusOf({ 'editor.tabSize': 4, ...rest }, ['opt-vscode'])).toBe('template-updated');
	});

	it('reads user-modified when the user added a key the template does not set', () => {
		const merged = { 'editor.tabSize': 4, ...generated() };
		expect(statusOf({ ...merged, 'my.key': 1 }, ['opt-vscode'], merged)).toBe('user-modified');
	});

	it('reads template-updated for a same-key conflict on an untouched file', () => {
		expect(statusOf({ ...generated(), 'editor.formatOnSave': false }, ['opt-vscode'])).toBe(
			'template-updated',
		);
	});

	it('reads both when the user also edited a file whose template conflicts', () => {
		const recorded = generated();
		expect(statusOf({ ...recorded, 'editor.formatOnSave': false }, ['opt-vscode'], recorded)).toBe(
			'both',
		);
	});

	it('reads template-updated after a lint-unit switch merges into the existing file', () => {
		// Scaffolded under ESLint, then core-oxlint joined the set: the generated op
		// now retires the ESLint keys and adds Oxc's, which is a merge into this file.
		expect(statusOf(generated('core-eslint'), ['opt-vscode', 'core-oxlint'])).toBe(
			'template-updated',
		);
	});

	it('reads unchanged under the lint unit the file was generated for', () => {
		expect(statusOf(generated('core-oxlint'), ['opt-vscode', 'core-oxlint'])).toBe('unchanged');
	});
});

describe('runDiff on a commented .vscode/settings.json (#216)', () => {
	let tmp: string;
	const commented = '{\n  // note\n  "editor.tabSize": 4\n}\n';

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-diff-jsonc-'));
		mkdirSync(join(tmp, '.vscode'));
		writeFileSync(join(tmp, '.vscode', 'settings.json'), commented);
		const state = buildStateFile({
			version: '1.0.0',
			units: builtinUnits(['opt-vscode']),
			files: { '.vscode/settings.json': hashBuffer(Buffer.from('{}\n')) },
		});
		writeFileSync(join(tmp, '.unbranded.json'), JSON.stringify(state));
	});

	afterEach(() => {
		vi.restoreAllMocks();
		rmSync(tmp, { recursive: true, force: true });
	});

	function capture(opts: { json?: boolean }): { code: number; text: string } {
		const out: string[] = [];
		vi.spyOn(process.stdout, 'write').mockImplementation(((m: string) => {
			out.push(String(m));
			return true;
		}) as typeof process.stdout.write);
		const code = runDiff({ cwd: tmp, ...opts });
		return { code, text: out.join('') };
	}

	it('names the file it cannot merge into, keeping user-modified and the exit code', () => {
		const { code, text } = capture({});
		expect(code).toBe(1);
		expect(text).toMatch(/user-modified\s+\.vscode\/settings\.json/);
		expect(text).toContain('Left .vscode/settings.json as is');
	});

	it('keeps --json parseable and free of the warning', () => {
		const { code, text } = capture({ json: true });
		expect(code).toBe(1);
		const report = JSON.parse(text) as { files: { path: string; status: string }[] };
		expect(report.files).toEqual([{ path: '.vscode/settings.json', status: 'user-modified' }]);
		expect(text).not.toContain('Left ');
	});
});

describe('runDiff on an .unbranded.json that does not parse (#231)', () => {
	let tmp: string;
	const BASELINE = '.unbranded/baseline/eslint.config.mjs.base';
	const conflicted = '<<<<<<< HEAD\n{}\n=======\n{}\n>>>>>>> theirs\n';

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-diff-malformed-'));
		writeFileSync(join(tmp, '.unbranded.json'), conflicted);
		mkdirSync(join(tmp, '.unbranded', 'baseline'), { recursive: true });
		writeFileSync(join(tmp, BASELINE), 'base\n');
	});

	afterEach(() => {
		vi.restoreAllMocks();
		rmSync(tmp, { recursive: true, force: true });
	});

	it.each([false, true])('refuses with stderr only and exit 1 (json: %s)', (json) => {
		const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
		const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
		expect(runDiff({ cwd: tmp, json })).toBe(1);
		expect(out).not.toHaveBeenCalled();
		expect(String(err.mock.calls[0]?.[0])).toContain('.unbranded.json');
		expect(readFileSync(join(tmp, '.unbranded.json'), 'utf-8')).toBe(conflicted);
		expect(existsSync(join(tmp, BASELINE))).toBe(true);
	});
});

// Derived from UNITS so a new option choice with files is covered without editing
// this list. Option-choice files used to get no template hash, so diff called
// them unchanged however far the template moved (#198).
const optionChoiceCases = UNITS.flatMap((unit) =>
	(unit.options ?? []).flatMap((option) =>
		option.choices
			.filter((choice) => choice.files?.length)
			.map((choice) => ({
				label: `${unit.id} ${option.key}=${choice.value}`,
				unitId: unit.id,
				key: option.key,
				value: choice.value,
			})),
	),
);

// Writes every file the resolved unit ships with a trailing newline appended and
// records the hash of those new bytes, so the user axis reads clean and only the
// template axis can differ.
function ageUnitFiles(tmp: string, unitId: string, selections: Record<string, string>) {
	const unit = UNITS.find((u) => u.id === unitId);
	if (!unit) throw new Error(`no unit ${unitId}`);
	const files: Record<string, string> = {};
	for (const op of applyUnitOptions(unit, selections).files) {
		const plan = planFileOp(op, { pkgRoot: PKG_ROOT, targetDir: tmp });
		const aged = Buffer.concat([readSource(op, plan.src), Buffer.from('\n')]);
		mkdirSync(dirname(plan.dest), { recursive: true });
		writeFileSync(plan.dest, aged);
		files[plan.rel.split(sep).join('/')] = hashBuffer(aged);
	}
	return files;
}

describe('computeDiff on option-choice files (#198)', () => {
	let tmp: string;

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-diff-options-'));
	});

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	it('enumerates the known option-choice files, so an emptied table cannot pass vacuously', () => {
		expect(optionChoiceCases.length).toBeGreaterThanOrEqual(3);
		expect(new Set(optionChoiceCases.map((c) => c.unitId))).toEqual(
			new Set(['core-eslint', 'core-oxlint', 'core-typescript']),
		);
	});

	it.each(optionChoiceCases)(
		'classifies $label files as template-updated when aged with the record',
		({ unitId, key, value }) => {
			const choiceUnit = UNITS.find((u) => u.id === unitId);
			const choice = choiceUnit?.options
				?.find((o) => o.key === key)
				?.choices.find((c) => c.value === value);
			const files = ageUnitFiles(tmp, unitId, { [key]: value });
			const state = buildStateFile({
				version: '1.0.0',
				units: builtinUnits([unitId]),
				files,
				options: { [key]: value },
			});

			const report = computeDiff({ state, targetDir: tmp });
			for (const op of choice?.files ?? []) {
				const rel = (op.rename ? join(dirname(op.dest), op.rename) : op.dest).split(sep).join('/');
				expect(report.files.find((f) => f.path === rel)?.status, rel).toBe('template-updated');
			}
		},
	);

	it('replays the legacy dom flavor for a pre-#117 core-typescript with no options recorded', () => {
		const files = ageUnitFiles(tmp, 'core-typescript', { tsFlavor: 'dom' });
		const state = buildStateFile({
			version: '1.0.0',
			units: builtinUnits(['core-typescript']),
			files,
		});
		expect(state.options).toBeUndefined();

		const report = computeDiff({ state, targetDir: tmp });
		expect(report.files.find((f) => f.path === 'tsconfig.base.json')?.status).toBe(
			'template-updated',
		);
	});
});
