// core-oxlint ships in the same three flavors as core-eslint, so a project moving
// between the two lint units keeps what it lints for. oxlint compiles its plugins
// into the binary, so a flavor only changes which ones the config turns on, never
// what installs.
export type OxlintFlavor = 'base' | 'react' | 'next';

export const OXLINT_FLAVORS: OxlintFlavor[] = ['base', 'react', 'next'];

export const OXC_DEV_DEPENDENCIES: Record<string, string> = {
	oxlint: '1.86.0',
	oxfmt: '0.71.0',
};

// oxlint drops a rule whose plugin isn't listed here without a word, so this list
// is the whole contract. test/e2e/oxlint-flavors.spec.ts probes every entry.
const BASE_PLUGINS = ['eslint', 'typescript', 'unicorn', 'oxc', 'import'];
const REACT_PLUGINS = [...BASE_PLUGINS, 'react', 'jsx-a11y'];
const NEXT_PLUGINS = [...REACT_PLUGINS, 'nextjs'];

export function oxlintPlugins(flavor: OxlintFlavor): string[] {
	if (flavor === 'base') return [...BASE_PLUGINS];
	if (flavor === 'react') return [...REACT_PLUGINS];
	return [...NEXT_PLUGINS];
}

// oxlint lints node_modules unless a .gitignore says otherwise, and a fresh
// scaffold doesn't always have one. `.unbranded/**` holds the baseline copies
// `update` diffs against, so oxfmt must never rewrite them either.
const COMMON_IGNORES = [
	'.unbranded/**',
	'node_modules/**',
	'dist/**',
	'build/**',
	'out/**',
	'.next/**',
	'coverage/**',
];

// Both fixes come from running this config on a fresh Next app (kendrick/cambium#2).
// The automatic JSX runtime makes a React import dead weight, and a stylesheet
// enters the bundle through a bare `import './globals.css'` with nothing to assign.
const JSX_RULES = {
	'react/react-in-jsx-scope': 'off',
	'import/no-unassigned-import': ['error', { allow: ['**/*.css'] }],
};

export function buildOxlintConfig(flavor: OxlintFlavor): string {
	const config = {
		$schema: './node_modules/oxlint/configuration_schema.json',
		plugins: oxlintPlugins(flavor),
		categories: { correctness: 'error', suspicious: 'error' },
		env:
			flavor === 'base'
				? { builtin: true, node: true }
				: { builtin: true, browser: true, node: true },
		...(flavor === 'base' ? {} : { rules: JSX_RULES }),
		ignorePatterns: flavor === 'next' ? [...COMMON_IGNORES, 'next-env.d.ts'] : COMMON_IGNORES,
	};
	return `${JSON.stringify(config, null, '\t')}\n`;
}

// package.json is ignored because pnpm rewrites it with two-space indent on every
// `pnpm add`, so formatting it only produces churn. Markdown is ignored so a first
// `pnpm format` never rewrites someone's prose.
export function buildOxfmtConfig(): string {
	const config = {
		$schema: './node_modules/oxfmt/configuration_schema.json',
		useTabs: true,
		tabWidth: 2,
		printWidth: 100,
		semi: true,
		singleQuote: true,
		trailingComma: 'all',
		endOfLine: 'lf',
		ignorePatterns: [
			...COMMON_IGNORES,
			'pnpm-lock.yaml',
			'package-lock.json',
			'package.json',
			'**/*.md',
		],
	};
	return `${JSON.stringify(config, null, '\t')}\n`;
}
