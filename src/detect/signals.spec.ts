import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { effectiveDest, engines, hasDep, hasNodeVersionPin, hasScript } from './signals';

describe('hasDep', () => {
	it('finds a name in dependencies or devDependencies', () => {
		expect(hasDep({ dependencies: { react: '19' } }, 'react')).toBe(true);
		expect(hasDep({ devDependencies: { typescript: '5' } }, 'typescript')).toBe(true);
	});

	it('is false when absent, and tolerates missing/garbage maps', () => {
		expect(hasDep({ dependencies: { react: '19' } }, 'vue')).toBe(false);
		expect(hasDep({}, 'react')).toBe(false);
		// A hand-mangled package.json where deps is an array or null must not throw.
		expect(hasDep({ dependencies: ['react'] as unknown as Record<string, string> }, 'react')).toBe(false);
	});
});

describe('hasScript', () => {
	it('detects a named script, and only a string one', () => {
		expect(hasScript({ scripts: { test: 'vitest' } }, 'test')).toBe(true);
		expect(hasScript({ scripts: {} }, 'test')).toBe(false);
		expect(hasScript({ scripts: { test: 42 as unknown as string } }, 'test')).toBe(false);
	});
});

describe('engines', () => {
	it('returns the engines object, or undefined for a non-object', () => {
		expect(engines({ engines: { node: '>=22' } })).toEqual({ node: '>=22' });
		expect(engines({})).toBeUndefined();
		expect(engines({ engines: 'nope' as unknown as Record<string, string> })).toBeUndefined();
	});
});

describe('hasNodeVersionPin', () => {
	let tmp: string;
	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-signals-'));
	});
	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	it('is true on engines.node', () => {
		expect(hasNodeVersionPin(tmp, { engines: { node: '>=22' } })).toBe(true);
	});

	it('is true on a packageManager field', () => {
		expect(hasNodeVersionPin(tmp, { packageManager: 'pnpm@9.0.0' })).toBe(true);
	});

	it('is true when an .nvmrc file exists', () => {
		writeFileSync(join(tmp, '.nvmrc'), '22\n');
		expect(hasNodeVersionPin(tmp, {})).toBe(true);
	});

	it('is false with no pin anywhere', () => {
		expect(hasNodeVersionPin(tmp, {})).toBe(false);
	});
});

describe('effectiveDest', () => {
	it('returns dest unchanged when there is no rename', () => {
		expect(effectiveDest({ dest: '.editorconfig' })).toBe('.editorconfig');
	});

	it('swaps the basename but keeps the directory when renamed', () => {
		expect(effectiveDest({ dest: '.github/workflows/ci.yml', rename: 'main.yml' })).toBe('.github/workflows/main.yml');
	});

	it('renames a root-level file with no directory', () => {
		expect(effectiveDest({ dest: 'gitignore.template', rename: '.gitignore' })).toBe('.gitignore');
	});
});
