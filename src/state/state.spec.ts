import type { CopyResult } from '../fs/copy';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
});

describe('serializeState', () => {
	it('emits sorted keys, two-space indent, trailing newline — deterministic', () => {
		const a = serializeState(buildStateFile({ version: '1.0.0', units: ['core-eslint'], files: { b: '2', a: '1' } }));
		// Same inputs supplied in a different key order must serialize identically.
		const b = serializeState(buildStateFile({ version: '1.0.0', units: ['core-eslint'], files: { a: '1', b: '2' } }));
		expect(a).toBe(b);
		expect(a.endsWith('\n')).toBe(true);
		// Top-level keys alphabetical: files, schema, units, version.
		const order = [...a.matchAll(/^ {2}"(\w+)":/gm)].map(m => m[1]);
		expect(order).toEqual(['files', 'schema', 'units', 'version']);
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

	it('skips results whose destination never landed on disk', () => {
		writeFileSync(join(tmp, 'a.txt'), 'alpha\n');
		// b.txt was resolved as a CopyResult but does not exist (e.g. a skipped write).
		writeStateFile({ targetDir: tmp, units: ['core-eslint'], results: [result('a.txt'), result('b.txt')] });

		const state = readStateFile(tmp);
		expect(Object.keys(state?.files ?? {})).toEqual(['a.txt']);
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
