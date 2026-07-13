import type { EslintFlavor } from './eslint-config';
import type { Unit, UnitOptionChoice } from './types';
import { buildEslintConfig, ESLINT_FLAVORS, eslintDevDependencies } from './eslint-config';

// core-eslint's three flavors, built as UnitOption choices. Each choice ships the
// exact plugins it needs and a generated eslint.config.mjs delivered inline (via
// FileOp.content) so it flows through the same conflict/dry-run/state pipeline a
// copied file gets. base pulls zero React packages; react and next layer on.
const ESLINT_FLAVOR_META: Record<EslintFlavor, { label: string; hint: string }> = {
	base: { label: 'Base (TypeScript only)', hint: 'No React or Next plugins — for Node libraries and CLIs' },
	react: { label: 'React', hint: 'React, react-hooks, and strict jsx-a11y' },
	next: { label: 'Next.js', hint: 'React plus Next.js performance rules' },
};

const ESLINT_FLAVOR_CHOICES: UnitOptionChoice[] = ESLINT_FLAVORS.map(flavor => ({
	value: flavor,
	label: ESLINT_FLAVOR_META[flavor].label,
	hint: ESLINT_FLAVOR_META[flavor].hint,
	devDependencies: eslintDevDependencies(flavor),
	files: [{ content: buildEslintConfig(flavor), dest: 'eslint.config.mjs' }],
}));

// Versions pinned exactly. `unbranded --latest` is the escape hatch when
// users want bleeding edge; the default favors reproducibility.
//
// Order here drives the multiselect group order: foundation first, monorepo
// last. Within each category, units appear in the order declared.
export const UNITS: Unit[] = [
	{
		id: 'core-editorconfig',
		category: 'foundation',
		label: 'EditorConfig',
		description: 'Cross-editor whitespace and charset rules.',
		files: [
			{ src: '.editorconfig', dest: '.editorconfig' },
		],
		recommendedExtensions: ['editorconfig.editorconfig'],
	},
	{
		id: 'core-gitattributes',
		category: 'foundation',
		label: 'Git attributes',
		description: 'Normalizes line endings to LF and marks common binaries so diffs and merges stay clean.',
		files: [
			// Shipped as templates/gitattributes (no leading dot) so npm keeps it in
			// the tarball; it lands as .gitattributes in the target.
			{ src: 'templates/gitattributes', dest: '.gitattributes' },
		],
	},
	{
		id: 'core-node-version',
		category: 'foundation',
		label: 'Node version pin',
		description: 'Pins .nvmrc, engines.node, and the Corepack packageManager to your current toolchain.',
		// No static files. .nvmrc and the two package.json pins are computed at
		// write time from the running node major and the detected package manager
		// (see install/run.ts), so they track the environment rather than a value
		// frozen when this CLI was published. That's also why it owns .nvmrc alone
		// — a static copy from core-editorconfig could only ever be a stale guess.
		files: [],
	},
	{
		id: 'core-eslint',
		category: 'lint',
		label: 'ESLint',
		description: '@antfu base in a base/react/next flavor; jsx-a11y strict on the React flavors, dprint formatting for non-code files.',
		// The config and its plugins vary by flavor, so neither is static: the
		// eslintFlavor option below supplies eslint.config.mjs (as inline content)
		// and the exact devDependencies for the chosen flavor. A plain Node CLI
		// (base) then never gets React-ecosystem packages it can't use.
		files: [],
		options: [{
			key: 'eslintFlavor',
			label: 'ESLint flavor',
			default: 'base',
			choices: ESLINT_FLAVOR_CHOICES,
		}],
		packageJsonPatch: {
			scripts: {
				'lint': 'eslint .',
				'lint:fix': 'eslint . --fix',
			},
		},
		recommendedExtensions: ['dbaeumer.vscode-eslint'],
		// The eslint config sets `typescript: true`, which makes the antfu
		// preset attempt to load typescript. Without TS installed the config
		// itself fails to load — pull it in automatically. True in every flavor.
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
		recommendedExtensions: ['stylelint.vscode-stylelint'],
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
		recommendedExtensions: ['bradlc.vscode-tailwindcss'],
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
			vitest: '4.1.10',
			jsdom: '29.1.1',
		},
		packageJsonPatch: {
			scripts: {
				'test': 'vitest run',
				'test:watch': 'vitest',
			},
		},
		recommendedExtensions: ['vitest.explorer'],
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
		recommendedExtensions: ['ms-playwright.playwright'],
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
		// husky init wires core.hooksPath into .git/config, which file removal
		// can't reach — without this pointer, commits keep trying to run a hook
		// that's gone.
		removeNotes: 'husky set core.hooksPath in this repo\'s git config; run `git config --unset core.hooksPath` to fully detach the hooks.',
	},
	{
		id: 'opt-vscode',
		category: 'editor',
		label: 'VS Code workspace',
		description: 'Shared settings.json (merged, not clobbered) plus an extensions.json generated from the units you picked.',
		files: [
			{ src: 'opt-in/vscode/settings.json', dest: '.vscode/settings.json', mode: 'merge-json' },
			// No extensions.json here — it's generated at write time from the union
			// of recommendedExtensions across the selected units (see
			// install/vscode-extensions.ts), so it tracks the real selection instead
			// of a static blob. opt-vscode adds none of its own, so with nothing else
			// picked it degrades to an empty recommendation set rather than looping
			// back on itself.
		],
	},
	{
		id: 'opt-ci-github',
		category: 'ci',
		label: 'GitHub Actions CI',
		description: 'Runs install, lint, typecheck, and test on push and PR via GitHub Actions (pnpm).',
		files: [
			{ src: 'opt-in/ci-github/ci.yml', dest: '.github/workflows/ci.yml' },
		],
		// The shipped workflow calls pnpm lint / typecheck / test by name, so it
		// only passes on a fresh scaffold if those scripts exist — pull in the units
		// that define them (eslint drags in typescript via its own implies).
		// core-node-version writes the packageManager field pnpm/action-setup reads.
		implies: ['core-eslint', 'core-vitest', 'core-node-version'],
	},
	// opt-agents and opt-renovate from the original write-up are deferred (see
	// issue #22): opt-agents would push a whole working-memory framework, and
	// opt-renovate has no in-repo source yet. Each deserves its own issue.
	{
		id: 'opt-monorepo',
		category: 'monorepo',
		label: 'pnpm workspace + Turbo',
		description: 'Workspace yaml with build-script approvals for esbuild/sharp/unrs-resolver (pnpm 10 and 11) and a turbo.json baseline.',
		files: [
			{ src: 'opt-in/monorepo/pnpm-workspace.yaml', dest: 'pnpm-workspace.yaml' },
			{ src: 'opt-in/monorepo/turbo.json', dest: 'turbo.json' },
		],
		devDependencies: {
			turbo: '2.9.12',
		},
	},
];
