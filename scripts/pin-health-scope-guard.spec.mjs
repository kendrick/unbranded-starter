import { describe, expect, it } from 'vitest';
import {
	addedSpecLines,
	checkScope,
	globToRegExp,
	inScope,
	parsePorcelain,
} from './pin-health-scope-guard.mjs';

describe('inScope', () => {
	it.each([
		['src/manifest/eslint-config.ts', true],
		['src/manifest/nested/deep.ts', true],
		['templates/tsconfig.json', true],
		['postcss.config.mjs', true],
		['src/commands/doctor.spec.ts', true],
		['src/a.spec.ts', true],
		['test/e2e/preset-install.spec.ts', true],
		['.github/agent-memory/pin-health.md', true],
		['src/commands/doctor.ts', false],
		['scripts/bump-pins.mjs', false],
		['.github/workflows/ci.yml', false],
		['.github/agent-memory/other.md', false],
		['test/e2e/nested/x.spec.ts', false],
		['test/fixtures/x.json', false],
		['schemas/outdated.schema.json', false],
		['src/manifestx/index.ts', false],
	])('%s → %s', (path, expected) => {
		expect(inScope(path)).toBe(expected);
	});

	it('escapes regex metacharacters in literal segments', () => {
		expect(globToRegExp('postcss.config.mjs').test('postcssXconfigXmjs')).toBe(false);
	});
});

describe('parsePorcelain', () => {
	it('reads statuses and paths, and keeps both sides of a rename', () => {
		const raw =
			' M src/manifest/index.ts\0?? .github/agent-memory/pin-health.md\0R  src/manifest/new.ts\0src/cli.ts\0';
		expect(parsePorcelain(raw)).toEqual([
			{ status: ' M', path: 'src/manifest/index.ts' },
			{ status: '??', path: '.github/agent-memory/pin-health.md' },
			{ status: 'R ', path: 'src/manifest/new.ts' },
			{ status: 'R ', path: 'src/cli.ts' },
		]);
	});
});

describe('addedSpecLines', () => {
	it('collects added lines from spec files only', () => {
		const diff = [
			'diff --git a/src/manifest/index.ts b/src/manifest/index.ts',
			'+++ b/src/manifest/index.ts',
			"+const x = 'it.skip(';",
			'diff --git a/test/e2e/preset-install.spec.ts b/test/e2e/preset-install.spec.ts',
			'+++ b/test/e2e/preset-install.spec.ts',
			"+it.skip('flaky', () => {});",
			'-removed line',
		].join('\n');
		expect(addedSpecLines(diff)).toEqual({
			'test/e2e/preset-install.spec.ts': ["it.skip('flaky', () => {});"],
		});
	});
});

describe('checkScope', () => {
	it('passes in-scope edits with no gating', () => {
		expect(
			checkScope({
				entries: [{ status: ' M', path: 'src/manifest/eslint-config.ts' }],
				addedLines: { 'src/manifest/eslint-config.spec.ts': ["expect(lines).toContain('x');"] },
			}),
		).toEqual([]);
	});

	it('names an out-of-scope path', () => {
		expect(
			checkScope({ entries: [{ status: ' M', path: '.github/workflows/ci.yml' }], addedLines: {} }),
		).toEqual(['.github/workflows/ci.yml: outside the pin-health scope']);
	});

	it('refuses a deleted spec even though specs are in scope', () => {
		expect(
			checkScope({
				entries: [{ status: ' D', path: 'test/e2e/preset-install.spec.ts' }],
				addedLines: {},
			}),
		).toEqual(['test/e2e/preset-install.spec.ts: deletes a spec']);
	});

	it.each([
		["it.skip('x', () => {})"],
		["describe.skipIf(process.platform === 'win32')('x', () => {})"],
		["it.runIf(false)('x', () => {})"],
		["it.todo('x')"],
		["xit('x', () => {})"],
		["if (process.env.UB_PRESET !== 'next-app') return;"],
	])('refuses an added gate: %s', (line) => {
		expect(checkScope({ entries: [], addedLines: { 'test/e2e/a.spec.ts': [line] } })).toHaveLength(
			1,
		);
	});
});
