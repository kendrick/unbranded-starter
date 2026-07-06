import type { TrackedWrite } from './state';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyRemovalToState, buildStateFile, hashBuffer, readStateFile, serializeState, STATE_FILENAME, STATE_SCHEMA, writeStateFile } from './state';

describe('buildStateFile', () => {
	it('wraps the tracked files in a schema-versioned envelope', () => {
		const state = buildStateFile({ version: '1.2.3', units: ['core-eslint'], files: { 'a.txt': 'h' } });
		expect(state.schema).toBe(STATE_SCHEMA);
		expect(state.version).toBe('1.2.3');
	});

	it('sorts unit ids and file paths so the envelope is diff-stable', () => {
		const state = buildStateFile({
			version: '1.0.0',
			units: ['core-typescript', 'core-eslint'],
			files: { 'z.txt': 'h1', 'a.txt': 'h2' },
		});
		expect(state.units).toEqual(['core-eslint', 'core-typescript']);
		expect(Object.keys(state.files)).toEqual(['a.txt', 'z.txt']);
	});

	it('carries a self-describing hint so an agent that finds the file knows what reads it', () => {
		const state = buildStateFile({ version: '1.0.0', units: ['core-eslint'], files: {} });
		expect(state._tool).toMatch(/unbranded diff/);
		expect(state._tool).toMatch(/unbranded doctor/);
	});

	it('carries the v2 sibling maps — options, attribution, modes — key-sorted', () => {
		const state = buildStateFile({
			version: '1.0.0',
			units: ['core-eslint'],
			files: { 'a.txt': 'h' },
			options: { eslintFlavor: 'react' },
			attribution: { 'z.txt': 'core-eslint', 'a.txt': 'core-eslint' },
			modes: { 'a.txt': 'copy' },
		});
		expect(state.options).toEqual({ eslintFlavor: 'react' });
		expect(Object.keys(state.attribution ?? {})).toEqual(['a.txt', 'z.txt']);
		expect(state.modes).toEqual({ 'a.txt': 'copy' });
	});

	it('omits empty v2 maps the same way it omits an empty doctor block', () => {
		const state = buildStateFile({ version: '1.0.0', units: ['core-eslint'], files: {}, options: {}, attribution: {}, modes: {} });
		expect('options' in state).toBe(false);
		expect('attribution' in state).toBe(false);
		expect('modes' in state).toBe(false);
	});
});

describe('serializeState', () => {
	it('emits sorted keys, tab indent, trailing newline — deterministic', () => {
		const a = serializeState(buildStateFile({ version: '1.0.0', units: ['core-eslint'], files: { b: '2', a: '1' } }));
		// Same inputs supplied in a different key order must serialize identically.
		const b = serializeState(buildStateFile({ version: '1.0.0', units: ['core-eslint'], files: { a: '1', b: '2' } }));
		expect(a).toBe(b);
		expect(a.endsWith('\n')).toBe(true);
		// Tab indent so a scaffolded .unbranded.json satisfies the shipped ESLint
		// config's jsonc/indent, same as package.json (#48).
		expect(a).toContain('\n\t"');
		// Top-level keys alphabetical; the _tool hint sorts first (underscore).
		const order = [...a.matchAll(/^\t"(\w+)":/gm)].map(m => m[1]);
		expect(order).toEqual(['_tool', 'files', 'schema', 'units', 'version']);
	});
});

describe('hashBuffer', () => {
	it('is a stable content hash — same bytes, same digest', () => {
		expect(hashBuffer(Buffer.from('hello'))).toBe(hashBuffer(Buffer.from('hello')));
		expect(hashBuffer(Buffer.from('hello'))).not.toBe(hashBuffer(Buffer.from('world')));
	});
});

describe('writeStateFile / readStateFile', () => {
	let tmp: string;

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-state-'));
	});

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	function write(dest: string, unit = 'core-eslint' as TrackedWrite['unit'], mode: TrackedWrite['mode'] = 'copy'): TrackedWrite {
		return { dest: join(tmp, dest), unit, mode };
	}

	it('records hash, attribution, and mode for each written file that exists on disk', () => {
		writeFileSync(join(tmp, 'a.txt'), 'alpha\n');
		writeFileSync(join(tmp, 'b.txt'), 'bravo\n');

		writeStateFile({ targetDir: tmp, units: ['core-eslint'], writes: [write('a.txt'), write('b.txt', 'core-typescript')] });

		const state = readStateFile(tmp);
		expect(state?.files['a.txt']).toBe(hashBuffer(Buffer.from('alpha\n')));
		expect(state?.files['b.txt']).toBe(hashBuffer(Buffer.from('bravo\n')));
		expect(state?.attribution?.['a.txt']).toBe('core-eslint');
		expect(state?.attribution?.['b.txt']).toBe('core-typescript');
		expect(state?.modes?.['a.txt']).toBe('copy');
		expect(state?.units).toEqual(['core-eslint']);
	});

	it('tracks computed writes like any other file, keyed by their relative path', () => {
		// .nvmrc and .vscode/extensions.json are computed after the copy loop; they
		// arrive as mode 'computed' writes and must land in every map (issue #25 / F-00).
		writeFileSync(join(tmp, 'a.txt'), 'alpha\n');
		writeFileSync(join(tmp, '.nvmrc'), '24\n');

		writeStateFile({
			targetDir: tmp,
			units: ['core-node-version'],
			writes: [write('a.txt'), write('.nvmrc', 'core-node-version', 'computed')],
		});

		const state = readStateFile(tmp);
		expect(state?.files['.nvmrc']).toBe(hashBuffer(Buffer.from('24\n')));
		expect(state?.attribution?.['.nvmrc']).toBe('core-node-version');
		expect(state?.modes?.['.nvmrc']).toBe('computed');
		expect(Object.keys(state?.files ?? {})).toEqual(['.nvmrc', 'a.txt']);
	});

	it('skips writes whose destination never landed on disk, in every map', () => {
		writeFileSync(join(tmp, 'a.txt'), 'alpha\n');
		// b.txt was planned but does not exist (e.g. a skipped write).
		writeStateFile({ targetDir: tmp, units: ['core-eslint'], writes: [write('a.txt'), write('b.txt')] });

		const state = readStateFile(tmp);
		expect(Object.keys(state?.files ?? {})).toEqual(['a.txt']);
		expect(Object.keys(state?.attribution ?? {})).toEqual(['a.txt']);
		expect(Object.keys(state?.modes ?? {})).toEqual(['a.txt']);
	});

	it('records the run\'s resolved options and preserves them across an optionless re-run', () => {
		writeFileSync(join(tmp, 'a.txt'), 'alpha\n');
		writeStateFile({ targetDir: tmp, units: ['core-eslint'], writes: [write('a.txt')], options: { eslintFlavor: 'react' } });
		expect(readStateFile(tmp)?.options).toEqual({ eslintFlavor: 'react' });

		// A later run that resolved no options must not drop the recorded flavor:
		// remove and update need it to reconstruct what this scaffold meant.
		writeStateFile({ targetDir: tmp, units: ['core-eslint'], writes: [write('a.txt')] });
		expect(readStateFile(tmp)?.options).toEqual({ eslintFlavor: 'react' });
	});

	it('merges with prior tracking instead of replacing it', () => {
		// Run 1 scaffolds one unit; run 2 adds another. The day-2 verbs reason over
		// the whole history (remove reference-counts against state.units), so a
		// last-run-wins envelope would forget what an earlier run installed.
		writeFileSync(join(tmp, 'a.txt'), 'alpha\n');
		writeStateFile({ targetDir: tmp, units: ['core-eslint'], writes: [write('a.txt')] });

		writeFileSync(join(tmp, 'b.txt'), 'bravo\n');
		writeStateFile({ targetDir: tmp, units: ['opt-vscode'], writes: [write('b.txt', 'opt-vscode')] });

		const state = readStateFile(tmp);
		expect(state?.units).toEqual(['core-eslint', 'opt-vscode']);
		expect(Object.keys(state?.files ?? {})).toEqual(['a.txt', 'b.txt']);
		expect(state?.attribution?.['a.txt']).toBe('core-eslint');
		expect(state?.attribution?.['b.txt']).toBe('opt-vscode');
	});

	it('writes a byte-exact baseline for copy-mode files, and none for merge or computed modes', () => {
		writeFileSync(join(tmp, 'a.txt'), 'alpha\n');
		writeFileSync(join(tmp, 'settings.json'), '{"a":1}\n');
		writeFileSync(join(tmp, '.nvmrc'), '24\n');

		writeStateFile({ targetDir: tmp, units: ['core-eslint'], writes: [
			write('a.txt'),
			write('settings.json', 'opt-vscode', 'merge-json'),
			write('.nvmrc', 'core-node-version', 'computed'),
		] });

		// The baseline is the future merge base for `unbranded update`: identical
		// bytes, so base-vs-mine and base-vs-theirs comparisons are exact.
		expect(readFileSync(join(tmp, '.unbranded', 'baseline', 'a.txt'), 'utf-8')).toBe('alpha\n');
		// Structured and computed files update structurally, not by text merge.
		expect(existsSync(join(tmp, '.unbranded', 'baseline', 'settings.json'))).toBe(false);
		expect(existsSync(join(tmp, '.unbranded', 'baseline', '.nvmrc'))).toBe(false);
	});

	it('explains the sidecar with a README that tells users to commit it', () => {
		writeFileSync(join(tmp, 'a.txt'), 'alpha\n');
		writeStateFile({ targetDir: tmp, units: ['core-eslint'], writes: [write('a.txt')] });

		const readme = readFileSync(join(tmp, '.unbranded', 'README.md'), 'utf-8');
		expect(readme.toLowerCase()).toContain('commit');
		expect(readme).toContain('unbranded update');
	});

	it('prunes baselines for files that are no longer tracked, and keeps prior ones that are', () => {
		// A stray baseline (tracking removed, hand-copied file, whatever) must not
		// survive a rewrite — a wrong merge base is worse than none.
		mkdirSync(join(tmp, '.unbranded', 'baseline'), { recursive: true });
		writeFileSync(join(tmp, '.unbranded', 'baseline', 'stray.txt'), 'ghost\n');

		writeFileSync(join(tmp, 'a.txt'), 'alpha\n');
		writeStateFile({ targetDir: tmp, units: ['core-eslint'], writes: [write('a.txt')] });
		expect(existsSync(join(tmp, '.unbranded', 'baseline', 'stray.txt'))).toBe(false);

		// A second run that rewrites only b.txt keeps a.txt's baseline: a.txt is
		// still tracked, and its recorded base is the last one unbranded wrote.
		writeFileSync(join(tmp, 'a.txt'), 'user drift\n');
		writeFileSync(join(tmp, 'b.txt'), 'bravo\n');
		writeStateFile({ targetDir: tmp, units: ['core-eslint'], writes: [write('b.txt')] });
		expect(readFileSync(join(tmp, '.unbranded', 'baseline', 'a.txt'), 'utf-8')).toBe('alpha\n');
		expect(readFileSync(join(tmp, '.unbranded', 'baseline', 'b.txt'), 'utf-8')).toBe('bravo\n');
	});

	it('omits the doctor block on a fresh scaffold — no empty config nobody asked for', () => {
		writeFileSync(join(tmp, 'a.txt'), 'alpha\n');
		writeStateFile({ targetDir: tmp, units: ['core-eslint'], writes: [write('a.txt')] });
		expect(readFileSync(join(tmp, STATE_FILENAME), 'utf-8')).not.toContain('"doctor"');
	});

	it('preserves a user-managed doctor.ignore block across a re-scaffold', () => {
		// doctor.ignore is hand-edited into the tool-managed state file. Since every
		// run rewrites the envelope from scratch, writeStateFile has to carry the
		// block forward or the "durable off switch" evaporates on the next run.
		writeFileSync(join(tmp, 'a.txt'), 'alpha\n');
		writeStateFile({ targetDir: tmp, units: ['core-eslint'], writes: [write('a.txt')] });

		// Simulate the user accepting a finding by editing .unbranded.json.
		const path = join(tmp, STATE_FILENAME);
		const edited = { ...JSON.parse(readFileSync(path, 'utf-8')), doctor: { ignore: ['missing-editorconfig'] } };
		writeFileSync(path, `${JSON.stringify(edited, null, 2)}\n`);

		// A second scaffold must not clobber it.
		writeStateFile({ targetDir: tmp, units: ['core-eslint'], writes: [write('a.txt')] });
		expect(readStateFile(tmp)?.doctor?.ignore).toEqual(['missing-editorconfig']);
	});

	it('reads a schema-1 state file, leaving the v2 maps absent rather than erroring', () => {
		// Written by a pre-baseline CLI: consumers must treat the missing maps as
		// "degrade gracefully" (update falls back to overwrite-confirmation).
		writeFileSync(join(tmp, STATE_FILENAME), `${JSON.stringify({
			_tool: 'x',
			schema: 1,
			version: '0.6.0',
			units: ['core-eslint'],
			files: { 'a.txt': 'deadbeef' },
		}, null, '\t')}\n`);

		const state = readStateFile(tmp);
		expect(state?.files['a.txt']).toBe('deadbeef');
		expect(state?.attribution).toBeUndefined();
		expect(state?.options).toBeUndefined();
		expect(state?.modes).toBeUndefined();
	});

	it('returns undefined for an untracked directory and never throws on malformed state', () => {
		expect(readStateFile(tmp)).toBeUndefined();
		writeFileSync(join(tmp, STATE_FILENAME), '{ not json');
		expect(readStateFile(tmp)).toBeUndefined();
	});

	it('stamps the running CLI version so diffs know which template shipped', () => {
		writeFileSync(join(tmp, 'a.txt'), 'alpha\n');
		writeStateFile({ targetDir: tmp, units: ['core-eslint'], writes: [write('a.txt')] });
		const state = readStateFile(tmp);
		// The exact value tracks package.json; asserting it is a non-empty semver-ish string keeps the test robust.
		expect(state?.version).toMatch(/\d+\.\d+\.\d+/);
	});
});

describe('applyRemovalToState', () => {
	let tmp: string;

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-state-remove-'));
	});

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	function seed(): void {
		writeFileSync(join(tmp, 'a.txt'), 'alpha\n');
		writeFileSync(join(tmp, 'b.txt'), 'bravo\n');
		writeStateFile({
			targetDir: tmp,
			units: ['core-eslint', 'core-typescript'],
			writes: [
				{ dest: join(tmp, 'a.txt'), unit: 'core-eslint', mode: 'copy' },
				{ dest: join(tmp, 'b.txt'), unit: 'core-typescript', mode: 'copy' },
			],
			options: { eslintFlavor: 'react' },
		});
	}

	it('shrinks every map and prunes the removed file\'s baseline', () => {
		seed();
		applyRemovalToState({ targetDir: tmp, removeUnits: ['core-eslint'], removeFiles: ['a.txt'], removeOptionKeys: ['eslintFlavor'] });

		const state = readStateFile(tmp);
		expect(state?.units).toEqual(['core-typescript']);
		expect(Object.keys(state?.files ?? {})).toEqual(['b.txt']);
		expect(state?.attribution).toEqual({ 'b.txt': 'core-typescript' });
		expect(state?.modes).toEqual({ 'b.txt': 'copy' });
		expect(state?.options).toBeUndefined();
		expect(existsSync(join(tmp, '.unbranded', 'baseline', 'a.txt'))).toBe(false);
		expect(existsSync(join(tmp, '.unbranded', 'baseline', 'b.txt'))).toBe(true);
	});

	it('preserves doctor.ignore and option keys it was not told to drop', () => {
		seed();
		const path = join(tmp, STATE_FILENAME);
		const edited = { ...JSON.parse(readFileSync(path, 'utf-8')), doctor: { ignore: ['missing-editorconfig'] } };
		writeFileSync(path, `${JSON.stringify(edited, null, '\t')}\n`);

		applyRemovalToState({ targetDir: tmp, removeUnits: ['core-typescript'], removeFiles: ['b.txt'] });

		const state = readStateFile(tmp);
		expect(state?.doctor?.ignore).toEqual(['missing-editorconfig']);
		expect(state?.options).toEqual({ eslintFlavor: 'react' });
	});

	it('removing the last unit deletes the state file and the sidecar wholesale', () => {
		seed();
		applyRemovalToState({ targetDir: tmp, removeUnits: ['core-eslint', 'core-typescript'], removeFiles: ['a.txt', 'b.txt'] });
		// Nothing tracked means nothing to explain: a lingering envelope and README
		// would advertise management that no longer exists.
		expect(existsSync(join(tmp, STATE_FILENAME))).toBe(false);
		expect(existsSync(join(tmp, '.unbranded'))).toBe(false);
	});

	it('is a no-op without a state file', () => {
		expect(() => applyRemovalToState({ targetDir: tmp, removeUnits: ['core-eslint'], removeFiles: [] })).not.toThrow();
		expect(existsSync(join(tmp, STATE_FILENAME))).toBe(false);
	});
});
