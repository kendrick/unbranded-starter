import antfu from '@antfu/eslint-config';

export default antfu(
	{
		// ============================================
		// Framework Configuration
		// ============================================
		// Node-only CLI with no JSX or CSS. The react/next/jsx-a11y config this
		// repo scaffolds for other projects lives in the core-eslint flavors
		// (src/manifest/eslint-config.ts), never on the repo itself.
		typescript: true,

		// ============================================
		// Formatting (handled by ESLint, not Prettier)
		// Prettier's .prettierrc is for editor format-on-save only;
		// CI runs `pnpm lint` which is ESLint.
		// ============================================
		formatters: {
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
			// `properties: 'never'` lets snake_case data shapes through:
			// env var keys (`npm_config_user_agent`), API responses, config
			// files that aren't ours. The rule still polices identifiers.
			'camelcase': ['error', { ignoreImports: true, properties: 'never' }],
			'import/no-default-export': 'off', // config files (vitest, tsup, eslint) default-export
			'style/multiline-ternary': 'off',
			'ts/no-explicit-any': 'error',
			// eslint-plugin-pnpm (auto-enabled by antfu when a pnpm-workspace.yaml
			// exists) injects `trustPolicy: no-downgrade` into it on every --fix,
			// which makes pnpm reject the lockfile. Off so monorepos scaffolded
			// from this starter stay clean.
			'pnpm/yaml-enforce-settings': 'off',

			// This repo is a Node-only CLI. Forcing `import process from
			// 'node:process'` and `import { Buffer } from 'node:buffer'`
			// adds noise without improving anything — both are globals at
			// every entry point we ship.
			'node/prefer-global/process': 'off',
			'node/prefer-global/buffer': 'off',
		},

		// ============================================
		// Ignored Paths
		// Note: `@antfu/eslint-config` has a built-in GLOB_EXCLUDE that
		// blanket-ignores '**/.claude' and '**/.agents'. We can't unignore
		// files inside those. For JSON/JSONC files in .claude/, format-on-save
		// is delegated to VS Code's built-in JSON formatter via the
		// [json]/[jsonc] per-language override in .vscode/settings.json.
		// ============================================
		ignores: [
			'.next',
			'node_modules',
			'dist',
			'build',
			'public',
			'out',
			'storybook-static',
			'src/components/ui', // shadcn-generated; don't lint
			'**/components/ui', // ditto for monorepos
			'*.min.*',

			// release-please owns these and rewrites them with its own
			// formatting on every release PR; linting them just fails the
			// release-merge commit. (release-please-config.json is ours — we
			// author it, release-please never rewrites it — so it lints.)
			'CHANGELOG.md',
			'.release-please-manifest.json',

			// .specify: ignore bundled extensions/scripts/templates/integrations
			// (tool-managed). Project-owned config files lint normally.
			'.specify/extensions/**',
			'.specify/scripts/**',
			'.specify/templates/**',
			'.specify/integrations/**',
			'**/.specify/extensions/**',
			'**/.specify/scripts/**',
			'**/.specify/templates/**',
			'**/.specify/integrations/**',
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
);
