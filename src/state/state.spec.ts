import type { CopyResult } from '../fs/copy';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildStateFile, hashBuffer, readStateFile, serializeState, STATE_FILENAME, STATE_SCHEMA, writeStateFile } from './state';

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

	function result(dest: string): CopyResult {
		return { src: join(tmp, 'src', dest), dest: join(tmp, dest), action: 'copied' };
	}

	it('records one content hash per written file that exists on disk', () => {
		writeFileSync(join(tmp, 'a.txt'), 'alpha\n');
		writeFileSync(join(tmp, 'b.txt'), 'bravo\n');

		writeStateFile({ targetDir: tmp, units: ['core-eslint'], results: [result('a.txt'), result('b.txt')] });

		const state = readStateFile(tmp);
		expect(state?.files['a.txt']).toBe(hashBuffer(Buffer.from('alpha\n')));
		expect(state?.files['b.txt']).toBe(hashBuffer(Buffer.from('bravo\n')));
		expect(state?.units).toEqual(['core-eslint']);
	});

	it('hashes computed writes passed via extraWrites, keyed by their relative path', () => {
		// .nvmrc and .vscode/extensions.json are computed after the copy loop, so
		// they reach writeStateFile as absolute paths rather than CopyResults. They
		// must land in the map exactly like a copied file (issue #25 / F-00).
		writeFileSync(join(tmp, 'a.txt'), 'alpha\n');
		writeFileSync(join(tmp, '.nvmrc'), '24\n');

		writeStateFile({
			targetDir: tmp,
			units: ['core-node-version'],
			results: [result('a.txt')],
			extraWrites: [join(tmp, '.nvmrc')],
		});

		const state = readStateFile(tmp);
		expect(state?.files['.nvmrc']).toBe(hashBuffer(Buffer.from('24\n')));
		expect(Object.keys(state?.files ?? {})).toEqual(['.nvmrc', 'a.txt']);
	});

	it('skips results whose destination never landed on disk', () => {
		writeFileSync(join(tmp, 'a.txt'), 'alpha\n');
		// b.txt was resolved as a CopyResult but does not exist (e.g. a skipped write).
		writeStateFile({ targetDir: tmp, units: ['core-eslint'], results: [result('a.txt'), result('b.txt')] });

		const state = readStateFile(tmp);
		expect(Object.keys(state?.files ?? {})).toEqual(['a.txt']);
	});

	it('omits the doctor block on a fresh scaffold — no empty config nobody asked for', () => {
		writeFileSync(join(tmp, 'a.txt'), 'alpha\n');
		writeStateFile({ targetDir: tmp, units: ['core-eslint'], results: [result('a.txt')] });
		expect(readFileSync(join(tmp, STATE_FILENAME), 'utf-8')).not.toContain('"doctor"');
	});

	it('preserves a user-managed doctor.ignore block across a re-scaffold', () => {
		// doctor.ignore is hand-edited into the tool-managed state file. Since every
		// run rewrites the envelope from scratch, writeStateFile has to carry the
		// block forward or the "durable off switch" evaporates on the next run.
		writeFileSync(join(tmp, 'a.txt'), 'alpha\n');
		writeStateFile({ targetDir: tmp, units: ['core-eslint'], results: [result('a.txt')] });

		// Simulate the user accepting a finding by editing .unbranded.json.
		const path = join(tmp, STATE_FILENAME);
		const edited = { ...JSON.parse(readFileSync(path, 'utf-8')), doctor: { ignore: ['missing-editorconfig'] } };
		writeFileSync(path, `${JSON.stringify(edited, null, 2)}\n`);

		// A second scaffold must not clobber it.
		writeStateFile({ targetDir: tmp, units: ['core-eslint'], results: [result('a.txt')] });
		expect(readStateFile(tmp)?.doctor?.ignore).toEqual(['missing-editorconfig']);
	});

	it('returns undefined for an untracked directory and never throws on malformed state', () => {
		expect(readStateFile(tmp)).toBeUndefined();
		writeFileSync(join(tmp, STATE_FILENAME), '{ not json');
		expect(readStateFile(tmp)).toBeUndefined();
	});

	it('stamps the running CLI version so diffs know which template shipped', () => {
		writeFileSync(join(tmp, 'a.txt'), 'alpha\n');
		writeStateFile({ targetDir: tmp, units: ['core-eslint'], results: [result('a.txt')] });
		const state = readStateFile(tmp);
		// The exact value tracks package.json; asserting it is a non-empty semver-ish string keeps the test robust.
		expect(state?.version).toMatch(/\d+\.\d+\.\d+/);
	});
});
