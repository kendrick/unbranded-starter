/** @type {import('stylelint').Config} */
export default {
	ignoreFiles: ['**/dist/**', '**/node_modules/**', '**/.next/**', '**/out/**', '**/build/**'],
	extends: [
		// Standard CSS rules
		'stylelint-config-standard',
		// Tailwind CSS v4 support (@theme, @custom-variant, @source, etc.)
		'@dreamsicle.io/stylelint-config-tailwindcss',
	],
	rules: {
		// Allow Tailwind's @apply directive
		'at-rule-no-unknown': [
			true,
			{
				ignoreAtRules: [
					'tailwind',
					'apply',
					'layer',
					'config',
					'plugin',
					'source',
					'theme',
					'utility',
					'variant',
					'custom-variant',
				],
			},
		],
		// Allow Tailwind's theme() and other functions
		'function-no-unknown': [
			true,
			{
				ignoreFunctions: ['theme', 'screen', 'spacing', 'alpha'],
			},
		],
		// Indentation is handled by ESLint's CSS formatter
		// Allow empty lines in custom properties blocks
		'custom-property-empty-line-before': null,
		// Don't require quotes in font-family (Tailwind uses unquoted)
		'font-family-name-quotes': null,
		// Allow Tailwind's color functions like oklch()
		'color-function-notation': null,
		// Allow alpha values in oklch
		'alpha-value-notation': null,
		// Don't require empty lines before consecutive comments
		'comment-empty-line-before': ['always', { except: ['first-nested'], ignore: ['after-comment'] }],
	},
};
