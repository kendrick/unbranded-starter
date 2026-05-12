import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { inspectTarget } from './target';

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
