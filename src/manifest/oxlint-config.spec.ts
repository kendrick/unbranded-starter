import { describe, expect, it } from 'vitest';
import {
	buildOxfmtConfig,
	buildOxlintConfig,
	OXC_DEV_DEPENDENCIES,
	OXLINT_FLAVORS,
	oxlintPlugins,
} from './oxlint-config';

// pin-bumps.yml moves these pins weekly and never edits specs, so assert only that each pin is an exact version.
const EXACT_VERSION: unknown = expect.stringMatching(/^\d+\.\d+\.\d+$/);

interface Parsed {
	plugins: string[];
	categories: Record<string, string>;
	ignorePatterns: string[];
	rules: Record<string, unknown>;
	options: Record<string, unknown>;
	useTabs: boolean;
}

// JSON.parse returns any, which the type-aware lint rules refuse to read through.
function parse(json: string): Parsed {
	return JSON.parse(json) as Parsed;
}

describe('oxlint flavors', () => {
	it('enables react and jsx-a11y only from react up, and nextjs only on next', () => {
		expect(oxlintPlugins('base')).toEqual(['eslint', 'typescript', 'unicorn', 'oxc', 'import']);
		expect(oxlintPlugins('react')).toEqual([
			'eslint',
			'typescript',
			'unicorn',
			'oxc',
			'import',
			'react',
			'jsx-a11y',
		]);
		expect(oxlintPlugins('next')).toEqual([
			'eslint',
			'typescript',
			'unicorn',
			'oxc',
			'import',
			'react',
			'jsx-a11y',
			'nextjs',
		]);
	});

	it("writes each flavor's plugins into the config it generates", () => {
		for (const flavor of OXLINT_FLAVORS) {
			const config = parse(buildOxlintConfig(flavor));
			expect(config.plugins).toEqual(oxlintPlugins(flavor));
			expect(config.categories).toEqual({ correctness: 'error', suspicious: 'error' });
			expect(config.ignorePatterns).toContain('node_modules/**');
			expect(config.ignorePatterns).toContain('.unbranded/**');
		}
	});

	it('carries the cambium#2 fixes on react and next, and no rules block on base', () => {
		for (const flavor of ['react', 'next'] as const) {
			const { rules } = parse(buildOxlintConfig(flavor));
			expect(rules['react/react-in-jsx-scope']).toBe('off');
			expect(rules['import/no-unassigned-import']).toEqual(['error', { allow: ['**/*.css'] }]);
		}
		expect(parse(buildOxlintConfig('base'))).not.toHaveProperty('rules');
		expect(parse(buildOxlintConfig('next')).ignorePatterns).toContain('next-env.d.ts');
	});

	it('keeps oxfmt off package.json and markdown', () => {
		const config = parse(buildOxfmtConfig());
		expect(config.ignorePatterns).toEqual(
			expect.arrayContaining(['package.json', '**/*.md', 'node_modules/**']),
		);
		expect(config.useTabs).toBe(true);
	});

	it('turns on type-aware linting for every flavor (#195)', () => {
		for (const flavor of OXLINT_FLAVORS)
			expect(parse(buildOxlintConfig(flavor)).options).toEqual({ typeAware: true });
	});

	it('pins the three binaries exactly', () => {
		expect(OXC_DEV_DEPENDENCIES).toEqual({
			'oxlint': EXACT_VERSION,
			'oxfmt': EXACT_VERSION,
			'oxlint-tsgolint': EXACT_VERSION,
		});
	});

	it('emits tab-indented JSON with a trailing newline, like the scaffolded .editorconfig asks', () => {
		expect(buildOxlintConfig('base')).toMatch(/^\{\n\t"/);
		expect(buildOxlintConfig('base').endsWith('}\n')).toBe(true);
	});
});
