import type { AnyUnit } from './types';

// opt-husky's lint-staged config depends on which lint unit resolved: a static
// file ran `eslint --fix` in core-oxlint projects, where ESLint isn't installed.
// It rides opt-husky as an inline FileOp so conflicts, rollback, and state treat
// it like any written file, and `update` regenerates it for the installed set.
export const LINT_STAGED_DEST = 'lint-staged.config.mjs';

const CODE_GLOB = '*.{js,mjs,cjs,ts,tsx,jsx}';
const DATA_GLOB = '*.{json,md,mdx,yaml,yml}';
const CSS_GLOB = '*.{css,scss,postcss}';

// lint-staged hands over explicit paths. When every one is a path the tool
// ignores (.oxfmtrc.json skips package.json and markdown), oxfmt and oxlint exit
// non-zero and block the commit; the flag makes that case a no-op.
const OXLINT_FIX = 'oxlint --no-error-on-unmatched-pattern --fix';
const OXFMT = 'oxfmt --no-error-on-unmatched-pattern';

export function buildLintStagedConfig(selected: ReadonlySet<string>): string {
	const entries: Array<[string, string[]]> = [];
	if (selected.has('core-oxlint')) {
		entries.push([CODE_GLOB, [OXLINT_FIX, OXFMT]], [DATA_GLOB, [OXFMT]]);
	}
	else if (selected.has('core-eslint')) {
		entries.push([CODE_GLOB, ['eslint --fix']], [DATA_GLOB, ['eslint --fix']]);
	}
	if (selected.has('core-stylelint'))
		entries.push([CSS_GLOB, ['stylelint --fix']]);

	// lint-staged exits 1 on an empty config and on a missing one, so a project
	// with no lint unit still needs one entry. An empty command list is a no-op.
	if (entries.length === 0)
		entries.push(['*', []]);

	const lines = entries.map(([glob, commands]) => `\t'${glob}': [${commands.map(c => `'${c}'`).join(', ')}],\n`).join('');
	return `/** @type {import('lint-staged').Configuration} */\nexport default {\n${lines}};\n`;
}

export function applyLintStaged(unit: AnyUnit, selected: ReadonlySet<string>): AnyUnit {
	if (unit.id !== 'opt-husky')
		return unit;
	return { ...unit, files: [...unit.files, { content: buildLintStagedConfig(selected), dest: LINT_STAGED_DEST }] };
}
