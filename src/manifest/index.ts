import type { Unit } from './types';

// Versions pinned exactly. `unbranded --latest` is the escape hatch when
// users want bleeding edge; the default favors reproducibility.
export const UNITS: Unit[] = [
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
			// directly. @next/eslint-plugin-next and eslint-plugin-format aren't
			// imported by name but the config references their rules and formatters,
			// so they have to be installed for the config to load.
			'@antfu/eslint-config': '8.3.0',
			'@next/eslint-plugin-next': '15.5.18',
			'eslint': '9.39.4',
			'eslint-plugin-format': '2.0.1',
			'eslint-plugin-jsx-a11y': '6.10.2',
		},
		packageJsonPatch: {
			scripts: {
				'lint': 'eslint .',
				'lint:fix': 'eslint . --fix',
			},
		},
	},
];
