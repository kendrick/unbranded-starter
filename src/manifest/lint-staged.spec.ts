import type { AnyUnit } from './types';
import { describe, expect, it } from 'vitest';
import { applyLintStaged, buildLintStagedConfig, LINT_STAGED_DEST } from './lint-staged';

// Today's static opt-in/husky-precommit/lint-staged.config.mjs, byte for byte.
const LEGACY = '/** @type {import(\'lint-staged\').Configuration} */\nexport default {\n\t\'*.{js,mjs,cjs,ts,tsx,jsx}\': [\'eslint --fix\'],\n\t\'*.{json,md,mdx,yaml,yml}\': [\'eslint --fix\'],\n\t\'*.{css,scss,postcss}\': [\'stylelint --fix\'],\n};\n';

describe('buildLintStagedConfig (#160)', () => {
	it('runs oxlint then oxfmt on code, and oxfmt on data, for core-oxlint', () => {
		const out = buildLintStagedConfig(new Set(['core-oxlint', 'opt-husky']));
		expect(out).toContain('\'*.{js,mjs,cjs,ts,tsx,jsx}\': [\'oxlint --no-error-on-unmatched-pattern --fix\', \'oxfmt --no-error-on-unmatched-pattern\'],');
		expect(out).toContain('\'*.{json,md,mdx,yaml,yml}\': [\'oxfmt --no-error-on-unmatched-pattern\'],');
		expect(out).not.toContain('eslint');
	});

	it('keeps today\'s ESLint config byte for byte when core-eslint and core-stylelint resolve', () => {
		expect(buildLintStagedConfig(new Set(['core-eslint', 'core-stylelint', 'opt-husky']))).toBe(LEGACY);
	});

	it('names eslint and never oxlint for core-eslint', () => {
		const out = buildLintStagedConfig(new Set(['core-eslint', 'opt-husky']));
		expect(out).toContain('eslint --fix');
		expect(out).not.toContain('oxlint');
		expect(out).not.toContain('stylelint');
	});

	it('writes no code or data entry without a lint unit, and still loads as a module', () => {
		const out = buildLintStagedConfig(new Set(['opt-husky']));
		expect(out).toBe('/** @type {import(\'lint-staged\').Configuration} */\nexport default {\n};\n');
	});

	it('adds the stylelint line only beside core-stylelint', () => {
		expect(buildLintStagedConfig(new Set(['core-oxlint', 'core-stylelint']))).toContain('\'*.{css,scss,postcss}\': [\'stylelint --fix\'],');
		expect(buildLintStagedConfig(new Set(['core-oxlint']))).not.toContain('stylelint');
	});
});

describe('applyLintStaged', () => {
	const husky: AnyUnit = { id: 'opt-husky', category: 'git', label: '', description: '', files: [{ src: 'opt-in/husky-precommit/.husky/pre-commit', dest: '.husky/pre-commit' }] };

	it('appends the generated config to opt-husky as an inline FileOp', () => {
		const out = applyLintStaged(husky, new Set(['opt-husky', 'core-oxlint']));
		expect(out.files).toHaveLength(2);
		expect(out.files[1]).toEqual({ content: buildLintStagedConfig(new Set(['opt-husky', 'core-oxlint'])), dest: LINT_STAGED_DEST });
	});

	it('leaves every other unit alone', () => {
		const other: AnyUnit = { ...husky, id: 'core-vitest' };
		expect(applyLintStaged(other, new Set(['core-oxlint']))).toBe(other);
	});
});
