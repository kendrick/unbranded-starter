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

			// .agent-guild: the whole tree is installer-managed and gets
			// overwritten on every `/agent-guild:init`, so lint fixes here are
			// lost on the next run and only serve to block the commit that
			// installs it. Same rationale as .specify above.
			'.agent-guild/**',
			'**/.agent-guild/**',
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
	// Agent guidance files own an installer-managed region
	// ============================================
	{
		// The Agent Guild installer rewrites its marked block on every run and
		// writes the @import with no blank lines around it, which is exactly
		// what prettier wants to add. Leaving the rule on makes the two tools
		// undo each other: `pnpm lint:fix` reformats, the next
		// `/agent-guild:init` reverts, and lint fails again. Prettier is off
		// here so the installer's output is the accepted form.
		files: ['CLAUDE.md', 'AGENTS.md'],
		rules: {
			'format/prettier': 'off',
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
