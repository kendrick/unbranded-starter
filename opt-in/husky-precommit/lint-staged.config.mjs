/** @type {import('lint-staged').Configuration} */
export default {
	'*.{js,mjs,cjs,ts,tsx,jsx}': ['eslint --fix'],
	'*.{json,md,mdx,yaml,yml}': ['eslint --fix'],
	'*.{css,scss,postcss}': ['stylelint --fix'],
};
