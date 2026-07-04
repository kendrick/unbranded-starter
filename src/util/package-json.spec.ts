import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readPackageJson } from './package-json';

describe('readPackageJson', () => {
	let tmp: string;

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-pkg-'));
	});

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	it('parses a valid manifest into a typed result', () => {
		writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'x', scripts: { test: 'vitest' } }));
		const read = readPackageJson(tmp);
		expect(read.kind).toBe('ok');
		if (read.kind === 'ok')
			expect(read.pkg.scripts?.test).toBe('vitest');
	});

	it('reports a missing manifest without throwing', () => {
		expect(readPackageJson(tmp).kind).toBe('missing');
	});

	it('reports malformed JSON as a distinct, catchable result — never throws', () => {
		writeFileSync(join(tmp, 'package.json'), '{ "name": ');
		const read = readPackageJson(tmp);
		expect(read.kind).toBe('malformed');
		// The audit surfaces this as a finding, so the parse error must survive.
		if (read.kind === 'malformed')
			expect(read.error.length).toBeGreaterThan(0);
	});
});
