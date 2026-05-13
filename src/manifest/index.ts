import type { Unit } from './types';

// Versions pinned exactly. `unbranded --latest` is the escape hatch when
// users want bleeding edge; the default favors reproducibility.
//
// Order here drives the multiselect group order: foundation first, monorepo
// last. Within each category, units appear in the order declared.
export const UNITS: Unit[] = [
	{
		id: 'core-editorconfig',
		category: 'foundation',
		label: 'EditorConfig + .nvmrc',
		description: 'Cross-editor whitespace rules and a Node version pin.',
		files: [
			{ src: '.editorconfig', dest: '.editorconfig' },
			{ src: '.nvmrc', dest: '.nvmrc' },
		],
	},
	{
		id: 'core-eslint',
		category: 'lint',
		label: 'ESLint',
		description: '@antfu base with react + nextjs + typescript, jsx-a11y strict, dprint formatting for non-code files.',
		files: [
			{ src: 'eslint.config.mjs', dest: 'eslint.config.mjs' },
		],
		devDependencies: {
			// eslint.config.mjs imports @antfu/eslint-config and eslint-plugin-jsx-a11y
			// directly. The rest are optional peers of @antfu/eslint-config that
			// our config opts into via `react: true` / `nextjs: true` — without
			// them installed, eslint fails to load (CI has no TTY for antfu's
			// auto-install prompt).
			'@antfu/eslint-config': '8.3.0',
			'@eslint-react/eslint-plugin': '3.0.0',
			'@next/eslint-plugin-next': '15.5.18',
			'eslint': '9.39.4',
			'eslint-plugin-format': '2.0.1',
			'eslint-plugin-jsx-a11y': '6.10.2',
			'eslint-plugin-react-refresh': '0.5.2',
		},
		packageJsonPatch: {
			scripts: {
				'lint': 'eslint .',
				'lint:fix': 'eslint . --fix',
			},
		},
		// The eslint config sets `typescript: true`, which makes the antfu
		// preset attempt to load typescript. Without TS installed the config
		// itself fails to load — pull it in automatically.
		implies: ['core-typescript'],
	},
	{
		id: 'core-typescript',
		category: 'types',
		label: 'TypeScript',
		description: 'Strict suite with noUncheckedIndexedAccess plus the rest.',
		files: [
			{ src: 'tsconfig.base.json', dest: 'tsconfig.base.json' },
			// A small tsconfig.json that extends the base. The plan calls this
			// out specifically — `extends` beats deep-merging for clarity.
			{ src: 'templates/tsconfig.json', dest: 'tsconfig.json' },
		],
		devDependencies: {
			'typescript': '5.9.3',
			'@types/node': '22.19.19',
		},
		packageJsonPatch: {
			scripts: {
				typecheck: 'tsc --noEmit',
			},
		},
	},
	{
		id: 'core-stylelint',
		category: 'style',
		label: 'Stylelint',
		description: 'CSS linting with stylelint-config-standard plus a Tailwind-aware preset.',
		files: [
			{ src: 'stylelint.config.mjs', dest: 'stylelint.config.mjs' },
		],
		devDependencies: {
			'stylelint': '17.11.0',
			'stylelint-config-standard': '40.0.0',
			'@dreamsicle.io/stylelint-config-tailwindcss': '1.2.2',
		},
		packageJsonPatch: {
			scripts: {
				'lint:css': 'stylelint "**/*.css" --allow-empty-input',
				'lint:css:fix': 'stylelint "**/*.css" --fix --allow-empty-input',
			},
		},
	},
	{
		id: 'core-tailwind',
		category: 'style',
		label: 'Tailwind v4',
		description: 'No JS config — Tailwind v4 is CSS-only. Add `@import "tailwindcss";` to your stylesheet.',
		// Tailwind v4 ships zero config files. Manifest is deps-only.
		files: [],
		devDependencies: {
			'tailwindcss': '4.3.0',
			'@tailwindcss/postcss': '4.3.0',
		},
	},
	{
		id: 'core-postcss',
		category: 'style',
		label: 'PostCSS',
		description: 'One-line PostCSS config that loads @tailwindcss/postcss.',
		files: [
			{ src: 'postcss.config.mjs', dest: 'postcss.config.mjs' },
		],
		// The shipped config refers to @tailwindcss/postcss; without Tailwind
		// installed, builds break at PostCSS plugin resolution time.
		implies: ['core-tailwind'],
	},
	{
		id: 'core-vitest',
		category: 'test',
		label: 'Vitest',
		description: 'Baseline jsdom test setup with the common excludes.',
		files: [
			{ src: 'vitest.config.ts', dest: 'vitest.config.ts' },
		],
		devDependencies: {
			vitest: '2.1.9',
			jsdom: '25.0.1',
		},
		packageJsonPatch: {
			scripts: {
				'test': 'vitest run',
				'test:watch': 'vitest',
			},
		},
	},
	{
		id: 'opt-playwright',
		category: 'e2e',
		label: 'Playwright + axe',
		description: 'Mobile-first device matrix with @axe-core/playwright wired up.',
		files: [
			{ src: 'opt-in/playwright/playwright.config.ts', dest: 'playwright.config.ts' },
		],
		devDependencies: {
			'@playwright/test': '1.60.0',
			'@axe-core/playwright': '4.11.3',
		},
		packageJsonPatch: {
			scripts: {
				'test:e2e': 'playwright test',
			},
		},
		postInstall: [
			{
				id: 'playwright-browsers',
				command: ['playwright', 'install'],
				prompt: 'Download Playwright browsers now? (a few hundred MB)',
				default: true,
			},
		],
	},
	{
		id: 'opt-shadcn',
		category: 'ui',
		label: 'shadcn/ui scaffold',
		description: 'components.json plus the cn() utility. Wire your stylesheet separately.',
		files: [
			{ src: 'opt-in/shadcn/components.json', dest: 'components.json' },
			{ src: 'opt-in/shadcn/lib-utils.ts', dest: 'src/lib/utils.ts' },
		],
		dependencies: {
			'clsx': '2.1.1',
			'tailwind-merge': '3.6.0',
		},
		// cn() uses tailwind-merge, which only earns its keep if Tailwind is
		// actually doing the styling. Without it the utility runs but does
		// nothing useful.
		implies: ['core-tailwind'],
	},
	{
		id: 'opt-husky',
		category: 'git',
		label: 'Husky + lint-staged',
		description: 'Pre-commit hook that runs lint-staged on changed files.',
		files: [
			{ src: 'opt-in/husky-precommit/.husky/pre-commit', dest: '.husky/pre-commit' },
			{ src: 'opt-in/husky-precommit/lint-staged.config.mjs', dest: 'lint-staged.config.mjs' },
		],
		devDependencies: {
			'husky': '9.1.7',
			'lint-staged': '17.0.4',
		},
		packageJsonPatch: {
			// `prepare` is npm's lifecycle hook for fresh clones — running it
			// here means `pnpm install` after cloning rewires the hooks.
			scripts: {
				prepare: 'husky',
			},
		},
		postInstall: [
			{
				id: 'husky-init',
				command: ['husky', 'init'],
				prompt: 'Run `husky init` to scaffold the .husky/ directory?',
				default: true,
				// husky init writes git hooks, which only work in a real repo.
				requires: 'git',
			},
		],
	},
	{
		id: 'opt-monorepo',
		category: 'monorepo',
		label: 'pnpm workspace + Turbo',
		description: 'Workspace yaml (with onlyBuiltDependencies for esbuild/sharp/unrs-resolver) and turbo.json baseline.',
		files: [
			{ src: 'opt-in/monorepo/pnpm-workspace.yaml', dest: 'pnpm-workspace.yaml' },
			{ src: 'opt-in/monorepo/turbo.json', dest: 'turbo.json' },
		],
		devDependencies: {
			turbo: '2.9.12',
		},
	},
];
