import { defineConfig } from 'tsdown';

// Two configs so the shebang banner lands on dist/cli.js alone. dist/index.js is
// imported as a library, never executed, so a shebang there is just noise.
//
// tsdown defaults to fixedExtension (.mjs) on platform: 'node', and package.json's
// bin/exports name .js, so both configs turn it off. Leaving it on renames the
// outputs with no error and breaks the published entry points.
export default defineConfig([
	{
		entry: { cli: 'src/cli.ts' },
		format: 'esm',
		target: 'node22',
		platform: 'node',
		fixedExtension: false,
		clean: true,
		dts: false,
		banner: '#!/usr/bin/env node',
		shims: false,
	},
	{
		entry: { index: 'src/index.ts' },
		format: 'esm',
		target: 'node22',
		platform: 'node',
		fixedExtension: false,
		// tsdown cleans once for the whole array before any config builds, so this
		// value can't wipe dist/cli.js either way. The cli config's `clean: true`
		// already empties dist/.
		clean: false,
		// tsconfig.base.json sets `incremental`, which the dts emit refuses without
		// a tsBuildInfoFile. That file ships as the core-typescript template, so the
		// override lives here rather than in a config scaffolded projects inherit.
		dts: { compilerOptions: { incremental: false } },
		shims: false,
	},
]);
