import type { StateFile, TrackedWrite } from './state';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	applyRemovalToState,
	baselinePath,
	buildStateFile,
	builtinUnits,
	hashBuffer,
	legacyBaselinePath,
	readStateFile,
	refreshTrackedFiles,
	serializeState,
	SIDECAR_DIR,
	STATE_FILENAME,
	STATE_SCHEMA,
	writeStateFile,
} from './state';

// Most cases here assert on envelope contents and only ever set up a readable one,
// so they unwrap the read to the state and let the tri-state cases below carry the
// gate. Anything that comes back non-ok surfaces as an undefined assertion failure.
function readOk(dir: string): StateFile | undefined {
	const read = readStateFile(dir);
	return read.kind === 'ok' ? read.state : undefined;
}

describe('buildStateFile', () => {
	it('wraps the tracked files in a schema-versioned envelope', () => {
		const state = buildStateFile({
			version: '1.2.3',
			units: builtinUnits(['core-eslint']),
			files: { 'a.txt': 'h' },
		});
		expect(state.schema).toBe(STATE_SCHEMA);
		expect(state.version).toBe('1.2.3');
	});

	it('sorts unit ids and file paths so the envelope is diff-stable', () => {
		const state = buildStateFile({
			version: '1.0.0',
			units: builtinUnits(['core-typescript', 'core-eslint']),
			files: { 'z.txt': 'h1', 'a.txt': 'h2' },
		});
		expect(state.units).toEqual(builtinUnits(['core-eslint', 'core-typescript']));
		expect(Object.keys(state.files)).toEqual(['a.txt', 'z.txt']);
	});

	it('carries a self-describing hint so an agent that finds the file knows what reads it', () => {
		const state = buildStateFile({
			version: '1.0.0',
			units: builtinUnits(['core-eslint']),
			files: {},
		});
		expect(state._tool).toMatch(/unbranded diff/);
		expect(state._tool).toMatch(/unbranded doctor/);
	});

	it('carries the v2 sibling maps — options, attribution, modes — key-sorted', () => {
		const state = buildStateFile({
			version: '1.0.0',
			units: builtinUnits(['core-eslint']),
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
		const state = buildStateFile({
			version: '1.0.0',
			units: builtinUnits(['core-eslint']),
			files: {},
			options: {},
			attribution: {},
			modes: {},
		});
		expect('options' in state).toBe(false);
		expect('attribution' in state).toBe(false);
		expect('modes' in state).toBe(false);
	});
});

describe('serializeState', () => {
	it('emits sorted keys, tab indent, trailing newline — deterministic', () => {
		const a = serializeState(
			buildStateFile({
				version: '1.0.0',
				units: builtinUnits(['core-eslint']),
				files: { b: '2', a: '1' },
			}),
		);
		// Same inputs supplied in a different key order must serialize identically.
		const b = serializeState(
			buildStateFile({
				version: '1.0.0',
				units: builtinUnits(['core-eslint']),
				files: { a: '1', b: '2' },
			}),
		);
		expect(a).toBe(b);
		expect(a.endsWith('\n')).toBe(true);
		// Tab indent so a scaffolded .unbranded.json satisfies the shipped ESLint
		// config's jsonc/indent, same as package.json (#48).
		expect(a).toContain('\n\t"');
		// Top-level keys alphabetical; the _tool hint sorts first (underscore).
		const order = [...a.matchAll(/^\t"(\w+)":/gm)].map((m) => m[1]);
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

	function write(
		dest: string,
		unit = 'core-eslint' as TrackedWrite['unit'],
		mode: TrackedWrite['mode'] = 'copy',
	): TrackedWrite {
		return { dest: join(tmp, dest), unit, mode };
	}

	it('records hash, attribution, and mode for each written file that exists on disk', () => {
		writeFileSync(join(tmp, 'a.txt'), 'alpha\n');
		writeFileSync(join(tmp, 'b.txt'), 'bravo\n');

		writeStateFile({
			targetDir: tmp,
			units: builtinUnits(['core-eslint']),
			writes: [write('a.txt'), write('b.txt', 'core-typescript')],
		});

		const state = readOk(tmp);
		expect(state?.files['a.txt']).toBe(hashBuffer(Buffer.from('alpha\n')));
		expect(state?.files['b.txt']).toBe(hashBuffer(Buffer.from('bravo\n')));
		expect(state?.attribution?.['a.txt']).toBe('core-eslint');
		expect(state?.attribution?.['b.txt']).toBe('core-typescript');
		expect(state?.modes?.['a.txt']).toBe('copy');
		expect(state?.units).toEqual(builtinUnits(['core-eslint']));
	});

	it('tracks computed writes like any other file, keyed by their relative path', () => {
		// .nvmrc and .vscode/extensions.json are computed after the copy loop; they
		// arrive as mode 'computed' writes and must land in every map (issue #25 / F-00).
		writeFileSync(join(tmp, 'a.txt'), 'alpha\n');
		writeFileSync(join(tmp, '.nvmrc'), '24\n');

		writeStateFile({
			targetDir: tmp,
			units: builtinUnits(['core-node-version']),
			writes: [write('a.txt'), write('.nvmrc', 'core-node-version', 'computed')],
		});

		const state = readOk(tmp);
		expect(state?.files['.nvmrc']).toBe(hashBuffer(Buffer.from('24\n')));
		expect(state?.attribution?.['.nvmrc']).toBe('core-node-version');
		expect(state?.modes?.['.nvmrc']).toBe('computed');
		expect(Object.keys(state?.files ?? {})).toEqual(['.nvmrc', 'a.txt']);
	});

	it('skips writes whose destination never landed on disk, in every map', () => {
		writeFileSync(join(tmp, 'a.txt'), 'alpha\n');
		// b.txt was planned but does not exist (e.g. a skipped write).
		writeStateFile({
			targetDir: tmp,
			units: builtinUnits(['core-eslint']),
			writes: [write('a.txt'), write('b.txt')],
		});

		const state = readOk(tmp);
		expect(Object.keys(state?.files ?? {})).toEqual(['a.txt']);
		expect(Object.keys(state?.attribution ?? {})).toEqual(['a.txt']);
		expect(Object.keys(state?.modes ?? {})).toEqual(['a.txt']);
	});

	it("records the run's resolved options and preserves them across an optionless re-run", () => {
		writeFileSync(join(tmp, 'a.txt'), 'alpha\n');
		writeStateFile({
			targetDir: tmp,
			units: builtinUnits(['core-eslint']),
			writes: [write('a.txt')],
			options: { eslintFlavor: 'react' },
		});
		expect(readOk(tmp)?.options).toEqual({ eslintFlavor: 'react' });

		// A later run that resolved no options must not drop the recorded flavor:
		// remove and update need it to reconstruct what this scaffold meant.
		writeStateFile({
			targetDir: tmp,
			units: builtinUnits(['core-eslint']),
			writes: [write('a.txt')],
		});
		expect(readOk(tmp)?.options).toEqual({ eslintFlavor: 'react' });
	});

	it('merges with prior tracking instead of replacing it', () => {
		// Run 1 scaffolds one unit; run 2 adds another. The day-2 verbs reason over
		// the whole history (remove reference-counts against state.units), so a
		// last-run-wins envelope would forget what an earlier run installed.
		writeFileSync(join(tmp, 'a.txt'), 'alpha\n');
		writeStateFile({
			targetDir: tmp,
			units: builtinUnits(['core-eslint']),
			writes: [write('a.txt')],
		});

		writeFileSync(join(tmp, 'b.txt'), 'bravo\n');
		writeStateFile({
			targetDir: tmp,
			units: builtinUnits(['opt-vscode']),
			writes: [write('b.txt', 'opt-vscode')],
		});

		const state = readOk(tmp);
		expect(state?.units).toEqual(builtinUnits(['core-eslint', 'opt-vscode']));
		expect(Object.keys(state?.files ?? {})).toEqual(['a.txt', 'b.txt']);
		expect(state?.attribution?.['a.txt']).toBe('core-eslint');
		expect(state?.attribution?.['b.txt']).toBe('opt-vscode');
	});

	it('writes a byte-exact baseline for copy-mode files, and none for merge or computed modes', () => {
		writeFileSync(join(tmp, 'a.txt'), 'alpha\n');
		writeFileSync(join(tmp, 'settings.json'), '{"a":1}\n');
		writeFileSync(join(tmp, '.nvmrc'), '24\n');

		writeStateFile({
			targetDir: tmp,
			units: builtinUnits(['core-eslint']),
			writes: [
				write('a.txt'),
				write('settings.json', 'opt-vscode', 'merge-json'),
				write('.nvmrc', 'core-node-version', 'computed'),
			],
		});

		// The baseline is the future merge base for `unbranded update`: identical
		// bytes, so base-vs-mine and base-vs-theirs comparisons are exact.
		expect(readFileSync(join(tmp, '.unbranded', 'baseline', 'a.txt.base'), 'utf-8')).toBe(
			'alpha\n',
		);
		// Structured and computed files update structurally, not by text merge.
		expect(existsSync(join(tmp, '.unbranded', 'baseline', 'settings.json.base'))).toBe(false);
		expect(existsSync(join(tmp, '.unbranded', 'baseline', '.nvmrc.base'))).toBe(false);
	});

	it('explains the sidecar with a README that tells users to commit it', () => {
		writeFileSync(join(tmp, 'a.txt'), 'alpha\n');
		writeStateFile({
			targetDir: tmp,
			units: builtinUnits(['core-eslint']),
			writes: [write('a.txt')],
		});

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
		writeStateFile({
			targetDir: tmp,
			units: builtinUnits(['core-eslint']),
			writes: [write('a.txt')],
		});
		expect(existsSync(join(tmp, '.unbranded', 'baseline', 'stray.txt'))).toBe(false);

		// A second run that rewrites only b.txt keeps a.txt's baseline: a.txt is
		// still tracked, and its recorded base is the last one unbranded wrote.
		writeFileSync(join(tmp, 'a.txt'), 'user drift\n');
		writeFileSync(join(tmp, 'b.txt'), 'bravo\n');
		writeStateFile({
			targetDir: tmp,
			units: builtinUnits(['core-eslint']),
			writes: [write('b.txt')],
		});
		expect(readFileSync(join(tmp, '.unbranded', 'baseline', 'a.txt.base'), 'utf-8')).toBe(
			'alpha\n',
		);
		expect(readFileSync(join(tmp, '.unbranded', 'baseline', 'b.txt.base'), 'utf-8')).toBe(
			'bravo\n',
		);
	});

	it('omits the doctor block on a fresh scaffold — no empty config nobody asked for', () => {
		writeFileSync(join(tmp, 'a.txt'), 'alpha\n');
		writeStateFile({
			targetDir: tmp,
			units: builtinUnits(['core-eslint']),
			writes: [write('a.txt')],
		});
		expect(readFileSync(join(tmp, STATE_FILENAME), 'utf-8')).not.toContain('"doctor"');
	});

	it('preserves a user-managed doctor.ignore block across a re-scaffold', () => {
		// doctor.ignore is hand-edited into the tool-managed state file. Since every
		// run rewrites the envelope from scratch, writeStateFile has to carry the
		// block forward or the "durable off switch" evaporates on the next run.
		writeFileSync(join(tmp, 'a.txt'), 'alpha\n');
		writeStateFile({
			targetDir: tmp,
			units: builtinUnits(['core-eslint']),
			writes: [write('a.txt')],
		});

		// Simulate the user accepting a finding by editing .unbranded.json.
		const path = join(tmp, STATE_FILENAME);
		const edited = {
			...(JSON.parse(readFileSync(path, 'utf-8')) as StateFile),
			doctor: { ignore: ['missing-editorconfig'] },
		};
		writeFileSync(path, `${JSON.stringify(edited, null, 2)}\n`);

		// A second scaffold must not clobber it.
		writeStateFile({
			targetDir: tmp,
			units: builtinUnits(['core-eslint']),
			writes: [write('a.txt')],
		});
		expect(readOk(tmp)?.doctor?.ignore).toEqual(['missing-editorconfig']);
	});

	it('reads a schema-1 state file, leaving the v2 maps absent rather than erroring', () => {
		// Written by a pre-baseline CLI: consumers must treat the missing maps as
		// "degrade gracefully" (update falls back to overwrite-confirmation).
		writeFileSync(
			join(tmp, STATE_FILENAME),
			`${JSON.stringify(
				{
					_tool: 'x',
					schema: 1,
					version: '0.6.0',
					units: ['core-eslint'],
					files: { 'a.txt': 'deadbeef' },
				},
				null,
				'\t',
			)}\n`,
		);

		const state = readOk(tmp);
		expect(state?.files['a.txt']).toBe('deadbeef');
		expect(state?.attribution).toBeUndefined();
		expect(state?.options).toBeUndefined();
		expect(state?.modes).toBeUndefined();
	});

	it('widens the bare unit ids of a schema-2 file into built-in entries', () => {
		// Nothing but a built-in could be installed before schema 3, so this widening
		// is exact rather than a guess — and it has to happen at the door, or every
		// downstream id comparison would have to know which schema wrote the file.
		writeFileSync(
			join(tmp, STATE_FILENAME),
			`${JSON.stringify(
				{
					_tool: 'x',
					schema: 2,
					version: '1.0.2',
					units: ['core-eslint', 'opt-vscode'],
					files: { 'a.txt': 'deadbeef' },
					attribution: { 'a.txt': 'core-eslint' },
				},
				null,
				'\t',
			)}\n`,
		);

		expect(readOk(tmp)?.units).toEqual(builtinUnits(['core-eslint', 'opt-vscode']));
	});

	it('round-trips a dir-sourced unit so day-2 commands can find the definition again', () => {
		writeFileSync(join(tmp, 'a.txt'), 'alpha\n');
		writeStateFile({
			targetDir: tmp,
			units: [{ id: 'my-units/banner', source: { kind: 'dir', path: './my-units' } }],
			writes: [write('a.txt', 'my-units/banner')],
		});

		expect(readOk(tmp)?.units).toEqual([
			{ id: 'my-units/banner', source: { kind: 'dir', path: './my-units' } },
		]);
		expect(readOk(tmp)?.attribution?.['a.txt']).toBe('my-units/banner');
	});

	it('refuses a state file from a newer unbranded instead of reading it as untracked', () => {
		// The dangerous answer is "none": diff reads that as an unscaffolded project
		// and exits 0 clean, so a CI gate would pass on a repo it cannot read.
		writeFileSync(
			join(tmp, STATE_FILENAME),
			`${JSON.stringify(
				{
					_tool: 'x',
					schema: STATE_SCHEMA + 1,
					version: '9.9.9',
					units: [],
					files: {},
				},
				null,
				'\t',
			)}\n`,
		);

		const read = readStateFile(tmp);
		expect(read.kind).toBe('unsupported');
		expect(read.kind === 'unsupported' && read.schema).toBe(STATE_SCHEMA + 1);
	});

	it('refuses to merge onto an envelope it could not fully read', () => {
		writeFileSync(
			join(tmp, STATE_FILENAME),
			`${JSON.stringify(
				{
					_tool: 'x',
					schema: STATE_SCHEMA + 1,
					version: '9.9.9',
					units: [],
					files: {},
				},
				null,
				'\t',
			)}\n`,
		);
		writeFileSync(join(tmp, 'a.txt'), 'alpha\n');

		expect(() =>
			writeStateFile({
				targetDir: tmp,
				units: builtinUnits(['core-eslint']),
				writes: [write('a.txt')],
			}),
		).toThrow(/newer unbranded/);
	});

	it('reports no state for an untracked directory and malformed for an unparseable file', () => {
		expect(readStateFile(tmp).kind).toBe('none');
		writeFileSync(join(tmp, STATE_FILENAME), '{ not json');
		expect(readStateFile(tmp).kind).toBe('malformed');
	});

	it.each(['null', '[]', '42', '"s"'])(
		'reports malformed, without throwing, when the whole file is %s',
		(body) => {
			writeFileSync(join(tmp, STATE_FILENAME), body);
			expect(readStateFile(tmp).kind).toBe('malformed');
		},
	);

	it('refuses to write over a malformed file and leaves it and the baselines alone', () => {
		writeFileSync(join(tmp, 'a.txt'), 'a\n');
		writeStateFile({
			targetDir: tmp,
			units: builtinUnits(['core-eslint']),
			writes: [write('a.txt')],
		});
		const conflicted = `<<<<<<< HEAD\n${readFileSync(join(tmp, STATE_FILENAME), 'utf-8')}=======\n>>>>>>> theirs\n`;
		writeFileSync(join(tmp, STATE_FILENAME), conflicted);
		const baselines = readdirSync(join(tmp, SIDECAR_DIR, 'baseline'));
		expect(baselines.length).toBeGreaterThan(0);

		expect(() =>
			writeStateFile({
				targetDir: tmp,
				units: builtinUnits(['core-vitest']),
				writes: [write('a.txt')],
			}),
		).toThrow(STATE_FILENAME);
		expect(() =>
			applyRemovalToState({ targetDir: tmp, removeUnits: ['core-eslint'], removeFiles: [] }),
		).toThrow(STATE_FILENAME);
		expect(() => refreshTrackedFiles({ targetDir: tmp, entries: {} })).toThrow(STATE_FILENAME);

		expect(readFileSync(join(tmp, STATE_FILENAME), 'utf-8')).toBe(conflicted);
		expect(readdirSync(join(tmp, SIDECAR_DIR, 'baseline'))).toEqual(baselines);
	});

	it('still writes a fresh envelope when no state file exists', () => {
		writeFileSync(join(tmp, 'a.txt'), 'a\n');
		writeStateFile({
			targetDir: tmp,
			units: builtinUnits(['core-eslint']),
			writes: [write('a.txt')],
		});
		expect(readStateFile(tmp).kind).toBe('ok');
	});

	it('stores each copy-mode baseline under a `.base` suffix, never its real name', () => {
		// Under its real name a baseline `.oxfmtrc.json` or `tsconfig.json` is live
		// config to any tool walking the tree (#182).
		writeFileSync(join(tmp, 'tsconfig.json'), '{"compilerOptions":{}}\n');
		writeStateFile({
			targetDir: tmp,
			units: builtinUnits(['core-typescript']),
			writes: [write('tsconfig.json', 'core-typescript')],
		});

		expect(readFileSync(join(tmp, '.unbranded', 'baseline', 'tsconfig.json.base'), 'utf-8')).toBe(
			'{"compilerOptions":{}}\n',
		);
		expect(existsSync(join(tmp, '.unbranded', 'baseline', 'tsconfig.json'))).toBe(false);
	});

	it('suffixes every path segment, so `foo` and `foo.base/bar` both get a baseline', () => {
		// Suffixing only the file name sent `foo` to the file `baseline/foo.base` and
		// `foo.base/bar` under a directory of that same name, so syncSidecar threw.
		writeFileSync(join(tmp, 'foo'), 'foo bytes\n');
		mkdirSync(join(tmp, 'foo.base'));
		writeFileSync(join(tmp, 'foo.base', 'bar'), 'bar bytes\n');

		expect(() =>
			writeStateFile({
				targetDir: tmp,
				units: builtinUnits(['core-eslint']),
				writes: [write('foo'), write('foo.base/bar')],
			}),
		).not.toThrow();

		const baselineDir = join(tmp, '.unbranded', 'baseline');
		expect(readFileSync(join(baselineDir, 'foo.base'), 'utf-8')).toBe('foo bytes\n');
		expect(readFileSync(join(baselineDir, 'foo.base.base', 'bar.base'), 'utf-8')).toBe(
			'bar bytes\n',
		);
		expect(Object.keys(readOk(tmp)?.files ?? {}).sort()).toEqual(['foo', 'foo.base/bar']);
	});

	it('keeps a nested baseline through a later run that only rewrites another file', () => {
		// The prune compares against the same per-segment encoding the writer uses; a
		// mismatch would delete `src.base/x.ts.base` as a stray here.
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

	it('maps nested rels segment by segment and top-level rels to a single suffix', () => {
		const baselineDir = join(tmp, '.unbranded', 'baseline');
		expect(baselinePath(tmp, 'src/x.ts')).toBe(join(baselineDir, 'src.base', 'x.ts.base'));
		// A `\\` is part of a file name on posix but the separator on Windows, so only
		// Windows splits on it.
		expect(baselinePath(tmp, 'src\\x.ts')).toBe(
			sep === '\\'
				? join(baselineDir, 'src.base', 'x.ts.base')
				: join(baselineDir, 'src\\x.ts.base'),
		);
		expect(baselinePath(tmp, '.oxfmtrc.json')).toBe(join(baselineDir, '.oxfmtrc.json.base'));
		expect(legacyBaselinePath(tmp, 'src/x.ts')).toBe(join(baselineDir, 'src', 'x.ts'));
	});

	it('moves a legacy-named baseline to its `.base` name instead of pruning it', () => {
		// A pre-#182 sidecar: tsconfig.json is tracked and its baseline sits under the
		// real name. A run that doesn't rewrite tsconfig.json must keep that merge base.
		writeFileSync(join(tmp, 'tsconfig.json'), 'user drift\n');
		writeFileSync(join(tmp, 'a.txt'), 'alpha\n');
		writeFileSync(
			join(tmp, STATE_FILENAME),
			`${JSON.stringify(
				{
					_tool: 'x',
					schema: 3,
					version: '2.0.0',
					units: [{ id: 'core-typescript', source: { kind: 'builtin' } }],
					files: { 'tsconfig.json': 'deadbeef' },
					attribution: { 'tsconfig.json': 'core-typescript' },
					modes: { 'tsconfig.json': 'copy' },
				},
				null,
				'\t',
			)}\n`,
		);
		mkdirSync(join(tmp, '.unbranded', 'baseline'), { recursive: true });
		writeFileSync(join(tmp, '.unbranded', 'baseline', 'tsconfig.json'), 'legacy base\n');

		writeStateFile({
			targetDir: tmp,
			units: builtinUnits(['core-eslint']),
			writes: [write('a.txt')],
		});

		expect(readFileSync(join(tmp, '.unbranded', 'baseline', 'tsconfig.json.base'), 'utf-8')).toBe(
			'legacy base\n',
		);
		expect(existsSync(join(tmp, '.unbranded', 'baseline', 'tsconfig.json'))).toBe(false);
	});

	it('prunes a real-named file beside a schema-4 `.base` copy instead of migrating it', () => {
		// At schema 4 the `.base` copy is the merge base and a real-named file is a stray.
		writeFileSync(join(tmp, 'tsconfig.json'), 'user drift\n');
		writeFileSync(join(tmp, 'a.txt'), 'alpha\n');
		writeFileSync(
			join(tmp, STATE_FILENAME),
			`${JSON.stringify(
				{
					_tool: 'x',
					schema: 4,
					version: '2.0.0',
					units: [{ id: 'core-typescript', source: { kind: 'builtin' } }],
					files: { 'tsconfig.json': 'deadbeef' },
					attribution: { 'tsconfig.json': 'core-typescript' },
					modes: { 'tsconfig.json': 'copy' },
				},
				null,
				'\t',
			)}\n`,
		);
		mkdirSync(join(tmp, '.unbranded', 'baseline'), { recursive: true });
		writeFileSync(join(tmp, '.unbranded', 'baseline', 'tsconfig.json'), 'legacy base\n');
		writeFileSync(join(tmp, '.unbranded', 'baseline', 'tsconfig.json.base'), 'current base\n');

		writeStateFile({
			targetDir: tmp,
			units: builtinUnits(['core-eslint']),
			writes: [write('a.txt')],
		});

		expect(readFileSync(join(tmp, '.unbranded', 'baseline', 'tsconfig.json.base'), 'utf-8')).toBe(
			'current base\n',
		);
		expect(existsSync(join(tmp, '.unbranded', 'baseline', 'tsconfig.json'))).toBe(false);
	});

	it('writes schema 4, reads a schema-4 file, and refuses schema 5', () => {
		// 4 is the `.base` sidecar layout. A schema-3 reader would prune every `.base`
		// copy as a stray, so it has to refuse the project instead.
		writeFileSync(join(tmp, 'a.txt'), 'alpha\n');
		writeStateFile({
			targetDir: tmp,
			units: builtinUnits(['core-eslint']),
			writes: [write('a.txt')],
		});
		const written = JSON.parse(readFileSync(join(tmp, STATE_FILENAME), 'utf-8')) as StateFile;
		expect(written.schema).toBe(4);
		expect(readStateFile(tmp).kind).toBe('ok');

		writeFileSync(
			join(tmp, STATE_FILENAME),
			`${JSON.stringify({ ...written, schema: 5 }, null, '\t')}\n`,
		);
		const read = readStateFile(tmp);
		expect(read.kind).toBe('unsupported');
		expect(read.kind === 'unsupported' && read.schema).toBe(5);
	});

	it('stamps the running CLI version so diffs know which template shipped', () => {
		writeFileSync(join(tmp, 'a.txt'), 'alpha\n');
		writeStateFile({
			targetDir: tmp,
			units: builtinUnits(['core-eslint']),
			writes: [write('a.txt')],
		});
		const state = readOk(tmp);
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
			units: builtinUnits(['core-eslint', 'core-typescript']),
			writes: [
				{ dest: join(tmp, 'a.txt'), unit: 'core-eslint', mode: 'copy' },
				{ dest: join(tmp, 'b.txt'), unit: 'core-typescript', mode: 'copy' },
			],
			options: { eslintFlavor: 'react' },
		});
	}

	it("shrinks every map and prunes the removed file's baseline", () => {
		seed();
		applyRemovalToState({
			targetDir: tmp,
			removeUnits: ['core-eslint'],
			removeFiles: ['a.txt'],
			removeOptionKeys: ['eslintFlavor'],
		});

		const state = readOk(tmp);
		expect(state?.units).toEqual(builtinUnits(['core-typescript']));
		expect(Object.keys(state?.files ?? {})).toEqual(['b.txt']);
		expect(state?.attribution).toEqual({ 'b.txt': 'core-typescript' });
		expect(state?.modes).toEqual({ 'b.txt': 'copy' });
		expect(state?.options).toBeUndefined();
		expect(existsSync(join(tmp, '.unbranded', 'baseline', 'a.txt.base'))).toBe(false);
		expect(existsSync(join(tmp, '.unbranded', 'baseline', 'b.txt.base'))).toBe(true);
	});

	it('preserves doctor.ignore and option keys it was not told to drop', () => {
		seed();
		const path = join(tmp, STATE_FILENAME);
		const edited = {
			...(JSON.parse(readFileSync(path, 'utf-8')) as StateFile),
			doctor: { ignore: ['missing-editorconfig'] },
		};
		writeFileSync(path, `${JSON.stringify(edited, null, '\t')}\n`);

		applyRemovalToState({
			targetDir: tmp,
			removeUnits: ['core-typescript'],
			removeFiles: ['b.txt'],
		});

		const state = readOk(tmp);
		expect(state?.doctor?.ignore).toEqual(['missing-editorconfig']);
		expect(state?.options).toEqual({ eslintFlavor: 'react' });
	});

	it('removing the last unit deletes the state file and the sidecar wholesale', () => {
		seed();
		applyRemovalToState({
			targetDir: tmp,
			removeUnits: ['core-eslint', 'core-typescript'],
			removeFiles: ['a.txt', 'b.txt'],
		});
		// Nothing tracked means nothing to explain: a lingering envelope and README
		// would advertise management that no longer exists.
		expect(existsSync(join(tmp, STATE_FILENAME))).toBe(false);
		expect(existsSync(join(tmp, '.unbranded'))).toBe(false);
	});

	it('is a no-op without a state file', () => {
		expect(() =>
			applyRemovalToState({ targetDir: tmp, removeUnits: ['core-eslint'], removeFiles: [] }),
		).not.toThrow();
		expect(existsSync(join(tmp, STATE_FILENAME))).toBe(false);
	});
});

describe('refreshTrackedFiles', () => {
	let tmp: string;

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-state-refresh-'));
	});

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	it('updates hashes, rewrites baselines to the given bytes, and stamps the version', () => {
		writeFileSync(join(tmp, 'a.txt'), 'v1\n');
		writeStateFile({
			targetDir: tmp,
			units: builtinUnits(['core-eslint']),
			writes: [{ dest: join(tmp, 'a.txt'), unit: 'core-eslint', mode: 'copy' }],
		});

		// After an update the on-disk file may be the user's merge, while the
		// baseline must become the CURRENT template — they legitimately diverge
		// (keep-mine resolutions), so the caller supplies each separately.
		refreshTrackedFiles({
			targetDir: tmp,
			entries: { 'a.txt': { hash: 'newhash', baseline: 'template v2\n' } },
		});

		const state = readOk(tmp);
		expect(state?.files['a.txt']).toBe('newhash');
		expect(readFileSync(join(tmp, '.unbranded', 'baseline', 'a.txt.base'), 'utf-8')).toBe(
			'template v2\n',
		);
		// Attribution and units survive untouched.
		expect(state?.attribution?.['a.txt']).toBe('core-eslint');
		expect(state?.units).toEqual(builtinUnits(['core-eslint']));
	});

	it('refreshes a hash without touching the baseline when none is supplied', () => {
		writeFileSync(join(tmp, 'a.txt'), 'v1\n');
		writeStateFile({
			targetDir: tmp,
			units: builtinUnits(['core-eslint']),
			writes: [{ dest: join(tmp, 'a.txt'), unit: 'core-eslint', mode: 'copy' }],
		});

		refreshTrackedFiles({ targetDir: tmp, entries: { 'a.txt': { hash: 'newhash' } } });

		expect(readOk(tmp)?.files['a.txt']).toBe('newhash');
		expect(readFileSync(join(tmp, '.unbranded', 'baseline', 'a.txt.base'), 'utf-8')).toBe('v1\n');
	});

	it('writes a refreshed baseline under its `.base` name', () => {
		writeFileSync(join(tmp, 'tsconfig.json'), 'v1\n');
		writeStateFile({
			targetDir: tmp,
			units: builtinUnits(['core-typescript']),
			writes: [{ dest: join(tmp, 'tsconfig.json'), unit: 'core-typescript', mode: 'copy' }],
		});

		refreshTrackedFiles({
			targetDir: tmp,
			entries: { 'tsconfig.json': { hash: 'newhash', baseline: 'template v2\n' } },
		});

		expect(readFileSync(join(tmp, '.unbranded', 'baseline', 'tsconfig.json.base'), 'utf-8')).toBe(
			'template v2\n',
		);
		expect(existsSync(join(tmp, '.unbranded', 'baseline', 'tsconfig.json'))).toBe(false);
	});

	it('moves legacy-named baselines to `.base` before writing refreshed ones', () => {
		// A pre-#182 sidecar run through `unbranded update`: both tracked files keep
		// their copies under the real names. The refreshed file must end with only its
		// new bytes, and the unrefreshed one must keep its merge base under `.base`.
		writeFileSync(
			join(tmp, STATE_FILENAME),
			`${JSON.stringify(
				{
					_tool: 'x',
					schema: 3,
					version: '2.0.0',
					units: [{ id: 'core-oxlint', source: { kind: 'builtin' } }],
					files: { '.oxfmtrc.json': 'aaa', 'vitest.config.ts': 'bbb' },
					attribution: { '.oxfmtrc.json': 'core-oxlint', 'vitest.config.ts': 'core-oxlint' },
					modes: { '.oxfmtrc.json': 'copy', 'vitest.config.ts': 'copy' },
				},
				null,
				'\t',
			)}\n`,
		);
		const baselineDir = join(tmp, '.unbranded', 'baseline');
		mkdirSync(baselineDir, { recursive: true });
		writeFileSync(join(baselineDir, '.oxfmtrc.json'), 'legacy oxfmt\n');
		writeFileSync(join(baselineDir, 'vitest.config.ts'), 'legacy vitest\n');

		refreshTrackedFiles({
			targetDir: tmp,
			entries: {
				'vitest.config.ts': { hash: 'newhash', baseline: 'template v2\n' },
				'.oxfmtrc.json': { hash: 'hashonly' },
			},
		});

		expect(readFileSync(join(baselineDir, 'vitest.config.ts.base'), 'utf-8')).toBe('template v2\n');
		expect(readFileSync(join(baselineDir, '.oxfmtrc.json.base'), 'utf-8')).toBe('legacy oxfmt\n');
		expect(existsSync(join(baselineDir, 'vitest.config.ts'))).toBe(false);
		expect(existsSync(join(baselineDir, '.oxfmtrc.json'))).toBe(false);
	});

	it('leaves a real-named file alone at schema 4, since only schema 3 has legacy copies', () => {
		writeFileSync(join(tmp, 'a.txt'), 'v1\n');
		writeStateFile({
			targetDir: tmp,
			units: builtinUnits(['core-eslint']),
			writes: [{ dest: join(tmp, 'a.txt'), unit: 'core-eslint', mode: 'copy' }],
		});
		const baselineDir = join(tmp, '.unbranded', 'baseline');
		writeFileSync(join(baselineDir, 'a.txt'), 'not a legacy copy\n');

		refreshTrackedFiles({ targetDir: tmp, entries: { 'a.txt': { hash: 'newhash' } } });

		expect(readFileSync(join(baselineDir, 'a.txt.base'), 'utf-8')).toBe('v1\n');
		expect(readFileSync(join(baselineDir, 'a.txt'), 'utf-8')).toBe('not a legacy copy\n');
	});

	it('leaves a baseline-directory file alone when no tracked copy-mode file owns it', () => {
		// Migration renames only what the prior state says is ours. refreshTrackedFiles
		// never prunes, so an untracked file here survives untouched.
		writeFileSync(join(tmp, 'a.txt'), 'v1\n');
		writeStateFile({
			targetDir: tmp,
			units: builtinUnits(['core-eslint']),
			writes: [{ dest: join(tmp, 'a.txt'), unit: 'core-eslint', mode: 'copy' }],
		});
		const baselineDir = join(tmp, '.unbranded', 'baseline');
		writeFileSync(join(baselineDir, 'notes.txt'), 'mine\n');

		refreshTrackedFiles({ targetDir: tmp, entries: { 'a.txt': { hash: 'newhash' } } });

		expect(readFileSync(join(baselineDir, 'notes.txt'), 'utf-8')).toBe('mine\n');
		expect(existsSync(join(baselineDir, 'notes.txt.base'))).toBe(false);
	});

	function seedSchema3(modes: Record<string, TrackedWrite['mode']>): void {
		const files = Object.fromEntries(Object.keys(modes).map((rel) => [rel, 'h']));
		writeFileSync(
			join(tmp, STATE_FILENAME),
			`${JSON.stringify(
				{
					_tool: 'x',
					schema: 3,
					version: '2.0.0',
					units: [{ id: 'core-eslint', source: { kind: 'builtin' } }],
					files,
					modes,
				},
				null,
				'\t',
			)}\n`,
		);
	}

	it('migrates nested legacy copies and clears the directories they leave', () => {
		seedSchema3({ 'src/x.ts': 'copy', '.vscode/settings.json': 'merge-json' });
		const baselineDir = join(tmp, '.unbranded', 'baseline');
		mkdirSync(join(baselineDir, 'src'), { recursive: true });
		mkdirSync(join(baselineDir, '.vscode'), { recursive: true });
		writeFileSync(join(baselineDir, 'src', 'x.ts'), 'legacy x\n');
		writeFileSync(join(baselineDir, '.vscode', 'settings.json'), 'not a copy\n');

		refreshTrackedFiles({ targetDir: tmp, entries: {} });

		expect(readFileSync(join(baselineDir, 'src.base', 'x.ts.base'), 'utf-8')).toBe('legacy x\n');
		expect(existsSync(join(baselineDir, 'src'))).toBe(false);
		// Not a copy-mode file, so not ours to move.
		expect(readFileSync(join(baselineDir, '.vscode', 'settings.json'), 'utf-8')).toBe(
			'not a copy\n',
		);
		expect(readOk(tmp)?.schema).toBe(STATE_SCHEMA);
	});

	it('keeps both merge bases when `foo` and `foo.base` are tracked, and migrates once', () => {
		// Tracked `foo` moves to `baseline/foo.base`, which is where tracked `foo.base`
		// keeps its legacy copy. Moving in place deleted or overwrote one of the two.
		seedSchema3({ 'foo': 'copy', 'foo.base': 'copy' });
		const baselineDir = join(tmp, '.unbranded', 'baseline');
		mkdirSync(baselineDir, { recursive: true });
		writeFileSync(join(baselineDir, 'foo'), 'base of foo\n');
		writeFileSync(join(baselineDir, 'foo.base'), 'base of foo.base\n');

		refreshTrackedFiles({ targetDir: tmp, entries: {} });
		// A second write sees schema 4 and must not take `foo.base` for a legacy copy.
		refreshTrackedFiles({ targetDir: tmp, entries: {} });

		expect(readFileSync(baselinePath(tmp, 'foo'), 'utf-8')).toBe('base of foo\n');
		expect(readFileSync(baselinePath(tmp, 'foo.base'), 'utf-8')).toBe('base of foo.base\n');
		expect(existsSync(join(baselineDir, 'foo'))).toBe(false);
		expect(readdirSync(join(tmp, '.unbranded')).sort()).toEqual(['baseline']);
	});

	it('keeps both merge bases through a scaffold write over a schema-3 `foo` + `foo.base`', () => {
		seedSchema3({ 'foo': 'copy', 'foo.base': 'copy' });
		const baselineDir = join(tmp, '.unbranded', 'baseline');
		mkdirSync(baselineDir, { recursive: true });
		writeFileSync(join(baselineDir, 'foo'), 'base of foo\n');
		writeFileSync(join(baselineDir, 'foo.base'), 'base of foo.base\n');
		writeFileSync(join(tmp, 'a.txt'), 'alpha\n');

		writeStateFile({
			targetDir: tmp,
			units: builtinUnits(['core-eslint']),
			writes: [{ dest: join(tmp, 'a.txt'), unit: 'core-eslint', mode: 'copy' }],
		});

		expect(readFileSync(baselinePath(tmp, 'foo'), 'utf-8')).toBe('base of foo\n');
		expect(readFileSync(baselinePath(tmp, 'foo.base'), 'utf-8')).toBe('base of foo.base\n');
		expect(readFileSync(baselinePath(tmp, 'a.txt'), 'utf-8')).toBe('alpha\n');
	});

	it('is a no-op without a state file', () => {
		expect(() =>
			refreshTrackedFiles({ targetDir: tmp, entries: { 'a.txt': { hash: 'x' } } }),
		).not.toThrow();
		expect(existsSync(join(tmp, STATE_FILENAME))).toBe(false);
	});
});
