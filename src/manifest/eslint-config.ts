// core-eslint ships in flavors. The antfu preset already takes `react`/`nextjs`
// toggles, so rather than bundle every plugin into every repo (a plain Node CLI
// doesn't want React rules), the flavor decides which plugins install and which
// toggles the generated eslint.config.mjs carries. `next` is a superset of
// `react`, which is a superset of `base`.
export type EslintFlavor = 'base' | 'react' | 'next';

export const ESLINT_FLAVORS: EslintFlavor[] = ['base', 'react', 'next'];

// The base linter core plus the formatter peer every flavor's config needs
// (the `formatters` block is on in all three). Deliberately free of any
// React-ecosystem package so `base` stays lean, per the AC.
const BASE_DEPS: Record<string, string> = {
	'@antfu/eslint-config': '9.1.0',
	'eslint': '10.7.0',
	'eslint-plugin-format': '2.0.1',
};

// antfu opts into these via `react: true`; jsx-a11y is our own strict a11y pass
// appended on top. Without them installed the config fails to load.
const REACT_DEPS: Record<string, string> = {
	'@eslint-react/eslint-plugin': '5.17.3',
	'eslint-plugin-jsx-a11y': '6.10.2',
	'eslint-plugin-react-refresh': '0.5.3',
};

const NEXT_DEPS: Record<string, string> = {
	'@next/eslint-plugin-next': '16.2.10',
};

// The exact devDependencies a flavor installs. Pinned like every other unit; the
// `--latest` escape hatch rewrites them at install time.
export function eslintDevDependencies(flavor: EslintFlavor): Record<string, string> {
	if (flavor === 'base')
		return { ...BASE_DEPS };
	if (flavor === 'react')
		return { ...BASE_DEPS, ...REACT_DEPS };
	return { ...BASE_DEPS, ...REACT_DEPS, ...NEXT_DEPS };
}

// Non-interactive default: read what the target already depends on. A repo that
// pulls `next` wants the next flavor; one with `react` wants react; anything else
// gets base. next outranks react because it's the superset.
export function detectEslintFlavor(depNames: Iterable<string>): EslintFlavor {
	const names = new Set(depNames);
	if (names.has('next'))
		return 'next';
	if (names.has('react'))
		return 'react';
	return 'base';
}

// Next.js performance rules. Only valid when `nextjs: true` registers the plugin,
// so they're emitted for the next flavor alone.
const NEXT_RULES: string[] = [
	'\'@next/next/no-html-link-for-pages\': \'error\',',
	'\'@next/next/no-img-element\': \'error\',',
	'\'@next/next/no-sync-scripts\': \'error\',',
	'\'@next/next/no-head-import-in-document\': \'error\',',
	'\'@next/next/no-document-import-in-page\': \'error\',',
	'\'@next/next/no-duplicate-head\': \'error\',',
	'\'@next/next/google-font-display\': \'warn\',',
	'\'@next/next/google-font-preconnect\': \'warn\',',
	'\'@next/next/no-page-custom-font\': \'warn\',',
	'\'@next/next/no-title-in-document-head\': \'error\',',
	'\'@next/next/no-unwanted-polyfillio\': \'warn\',',
];

// Strict jsx-a11y pass, appended as its own config so the plugin registers. Only
// meaningful where there's JSX, so react and next carry it; base doesn't.
const JSX_A11Y_RULES: string[] = [
	'\'jsx-a11y/alt-text\': \'error\',',
	'\'jsx-a11y/anchor-has-content\': \'error\',',
	'\'jsx-a11y/anchor-is-valid\': \'error\',',
	'\'jsx-a11y/aria-activedescendant-has-tabindex\': \'error\',',
	'\'jsx-a11y/aria-props\': \'error\',',
	'\'jsx-a11y/aria-proptypes\': \'error\',',
	'\'jsx-a11y/aria-role\': \'error\',',
	'\'jsx-a11y/aria-unsupported-elements\': \'error\',',
	'\'jsx-a11y/click-events-have-key-events\': \'error\',',
	'\'jsx-a11y/heading-has-content\': \'error\',',
	'\'jsx-a11y/html-has-lang\': \'error\',',
	'\'jsx-a11y/img-redundant-alt\': \'error\',',
	'\'jsx-a11y/interactive-supports-focus\': \'error\',',
	'\'jsx-a11y/label-has-associated-control\': \'error\',',
	'\'jsx-a11y/media-has-caption\': \'error\',',
	'\'jsx-a11y/mouse-events-have-key-events\': \'error\',',
	'\'jsx-a11y/no-access-key\': \'error\',',
	'\'jsx-a11y/no-autofocus\': \'warn\',',
	'\'jsx-a11y/no-distracting-elements\': \'error\',',
	'\'jsx-a11y/no-interactive-element-to-noninteractive-role\': \'error\',',
	'\'jsx-a11y/no-noninteractive-element-interactions\': \'error\',',
	'\'jsx-a11y/no-noninteractive-element-to-interactive-role\': \'error\',',
	'\'jsx-a11y/no-noninteractive-tabindex\': \'error\',',
	'\'jsx-a11y/no-redundant-roles\': \'error\',',
	'\'jsx-a11y/no-static-element-interactions\': \'error\',',
	'\'jsx-a11y/role-has-required-aria-props\': \'error\',',
	'\'jsx-a11y/role-supports-aria-props\': \'error\',',
	'\'jsx-a11y/scope\': \'error\',',
	'\'jsx-a11y/tabindex-no-positive\': \'error\',',
];

const IGNORES: string[] = [
	'.next',
	'node_modules',
	'dist',
	'build',
	'coverage',
	'public',
	'out',
	'storybook-static',
	'**/components/ui',
	'*.min.*',
];

// Emit a complete, flavor-appropriate eslint.config.mjs as text. Formatted to
// pass its own antfu rules (tabs, single quotes, semicolons, trailing commas) so
// a fresh scaffold's first `pnpm lint` is clean without a fix pass. Delivered as
// FileOp.content, so it still flows through the conflict/dry-run/state pipeline.
export function buildEslintConfig(flavor: EslintFlavor): string {
	const react = flavor !== 'base';
	const next = flavor === 'next';
	const lines: string[] = [];

	lines.push('import antfu from \'@antfu/eslint-config\';');
	if (react)
		lines.push('import jsxA11y from \'eslint-plugin-jsx-a11y\';');
	lines.push('');
	lines.push('export default antfu(');

	// Primary options object.
	lines.push('\t{');
	if (react)
		lines.push('\t\treact: true,');
	if (next)
		lines.push('\t\tnextjs: true,');
	lines.push('\t\ttypescript: true,');
	lines.push('\t\tformatters: {');
	lines.push('\t\t\tcss: true,');
	lines.push('\t\t\thtml: true,');
	lines.push('\t\t\tmarkdown: true,');
	lines.push('\t\t\tjson: true,');
	lines.push('\t\t\tyaml: true,');
	lines.push('\t\t},');
	lines.push('\t\tstylistic: {');
	lines.push('\t\t\tindent: \'tab\',');
	lines.push('\t\t\tsemi: true,');
	lines.push('\t\t\tquotes: \'single\',');
	lines.push('\t\t\tarrowParens: \'always\',');
	lines.push('\t\t},');
	lines.push('\t\trules: {');
	lines.push('\t\t\t\'camelcase\': [\'error\', { ignoreImports: true, properties: \'never\' }],');
	lines.push('\t\t\t\'import/no-default-export\': \'off\',');
	lines.push('\t\t\t\'style/multiline-ternary\': \'off\',');
	lines.push('\t\t\t\'ts/no-explicit-any\': \'error\',');
	lines.push('\t\t\t\'pnpm/yaml-enforce-settings\': \'off\',');
	lines.push('\t\t\t\'node/prefer-global/process\': \'off\',');
	lines.push('\t\t\t\'node/prefer-global/buffer\': \'off\',');
	if (next) {
		for (const rule of NEXT_RULES)
			lines.push(`\t\t\t${rule}`);
	}
	lines.push('\t\t},');
	lines.push('\t\tignores: [');
	for (const ignore of IGNORES)
		lines.push(`\t\t\t'${ignore}',`);
	lines.push('\t\t],');
	lines.push('\t},');

	// Markdown: code blocks under numbered lists use mixed indent.
	lines.push('\t{');
	lines.push('\t\tfiles: [\'**/*.md\'],');
	lines.push('\t\trules: {');
	lines.push('\t\t\t\'style/no-mixed-spaces-and-tabs\': \'off\',');
	lines.push('\t\t},');
	lines.push('\t},');

	if (react) {
		lines.push('\t{');
		lines.push('\t\tplugins: {');
		lines.push('\t\t\t\'jsx-a11y\': jsxA11y,');
		lines.push('\t\t},');
		lines.push('\t\trules: {');
		for (const rule of JSX_A11Y_RULES)
			lines.push(`\t\t\t${rule}`);
		lines.push('\t\t},');
		lines.push('\t},');
	}

	lines.push(');');
	lines.push('');
	return lines.join('\n');
}
