import antfu from '@antfu/eslint-config';
import jsxA11y from 'eslint-plugin-jsx-a11y';

export default antfu(
	{
		// ============================================
		// Framework Configuration
		// ============================================
		react: true,    // react + react-hooks
		nextjs: true,   // @next/eslint-plugin-next — REMOVE for non-Next projects
		typescript: true,

		// ============================================
		// Formatting (handled by ESLint, not Prettier)
		// Prettier's .prettierrc is for editor format-on-save only;
		// CI runs `pnpm lint` which is ESLint.
		// ============================================
		formatters: {
			css: true,
			html: true,
			markdown: true,
			json: true,
			yaml: true,
		},
		stylistic: {
			indent: 'tab',
			semi: true,
			quotes: 'single',
			arrowParens: 'always',
		},

		// ============================================
		// Rule Overrides
		// ============================================
		rules: {
			// General
			'camelcase': ['error', { ignoreImports: true }],
			'import/no-default-export': 'off', // Next.js needs default exports
			'style/multiline-ternary': 'off',
			'ts/no-explicit-any': 'error',

			// -----------------------------------------
			// Next.js Performance (no-ops for non-Next projects)
			// -----------------------------------------
			'@next/next/no-html-link-for-pages': 'error',
			'@next/next/no-img-element': 'error',
			'@next/next/no-sync-scripts': 'error',
			'@next/next/no-head-import-in-document': 'error',
			'@next/next/no-document-import-in-page': 'error',
			'@next/next/no-duplicate-head': 'error',
			'@next/next/google-font-display': 'warn',
			'@next/next/google-font-preconnect': 'warn',
			'@next/next/no-page-custom-font': 'warn',
			'@next/next/no-title-in-document-head': 'error',
			'@next/next/no-unwanted-polyfillio': 'warn',
		},

		// ============================================
		// Ignored Paths
		// ============================================
		ignores: [
			'.agents',
			'.next',
			'.claude',
			'.specify',
			'node_modules',
			'dist',
			'build',
			'public',
			'out',
			'storybook-static',
			'src/components/ui', // shadcn-generated; don't lint
			'**/components/ui', // ditto for monorepos
			'*.min.*',
			'**/.agents',
			'**/.claude',
			'**/.specify/**',
		],
	},

	// ============================================
	// Markdown-specific overrides
	// Code blocks under numbered lists require mixed indent
	// ============================================
	{
		files: ['**/*.md'],
		rules: {
			'style/no-mixed-spaces-and-tabs': 'off',
		},
	},

	// ============================================
	// Design docs: specs & .specify directories
	// Code fences are illustrative, not production code
	// ============================================
	{
		files: ['**/.specify/**', '**/specs/**'],
		rules: {
			'import/no-duplicates': 'off',
		},
	},

	// ============================================
	// Specs .md files: code fences are illustrative
	// React hook rules don't apply to doc examples
	// ============================================
	{
		files: ['**/specs/**/*.md', '**/specs/**/*.md/**'],
		rules: {
			'react-hooks/rules-of-hooks': 'off',
			'react-hooks/exhaustive-deps': 'off',
		},
	},

	// ============================================
	// Accessibility (jsx-a11y) — Strict Mode
	// Appended as separate config for plugin registration.
	// 28 rules at `error` (plus `no-autofocus` at `warn`).
	// ============================================
	{
		plugins: {
			'jsx-a11y': jsxA11y,
		},
		rules: {
			'jsx-a11y/alt-text': 'error',
			'jsx-a11y/anchor-has-content': 'error',
			'jsx-a11y/anchor-is-valid': 'error',
			'jsx-a11y/aria-activedescendant-has-tabindex': 'error',
			'jsx-a11y/aria-props': 'error',
			'jsx-a11y/aria-proptypes': 'error',
			'jsx-a11y/aria-role': 'error',
			'jsx-a11y/aria-unsupported-elements': 'error',
			'jsx-a11y/click-events-have-key-events': 'error',
			'jsx-a11y/heading-has-content': 'error',
			'jsx-a11y/html-has-lang': 'error',
			'jsx-a11y/img-redundant-alt': 'error',
			'jsx-a11y/interactive-supports-focus': 'error',
			'jsx-a11y/label-has-associated-control': 'error',
			'jsx-a11y/media-has-caption': 'error',
			'jsx-a11y/mouse-events-have-key-events': 'error',
			'jsx-a11y/no-access-key': 'error',
			'jsx-a11y/no-autofocus': 'warn', // Sometimes needed for UX
			'jsx-a11y/no-distracting-elements': 'error',
			'jsx-a11y/no-interactive-element-to-noninteractive-role': 'error',
			'jsx-a11y/no-noninteractive-element-interactions': 'error',
			'jsx-a11y/no-noninteractive-element-to-interactive-role': 'error',
			'jsx-a11y/no-noninteractive-tabindex': 'error',
			'jsx-a11y/no-redundant-roles': 'error',
			'jsx-a11y/no-static-element-interactions': 'error',
			'jsx-a11y/role-has-required-aria-props': 'error',
			'jsx-a11y/role-supports-aria-props': 'error',
			'jsx-a11y/scope': 'error',
			'jsx-a11y/tabindex-no-positive': 'error',
		},
	},
);
