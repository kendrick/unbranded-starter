import { defineConfig } from 'tsdown';

// Two configs, mirroring the tsup setup this replaces. The shebang banner is
// scoped to the cli build alone—dist/index.js is imported as a library, not
// executed. tsdown defaults to fixedExtension (.mjs) on platform: 'node';
// package.json's bin/exports name .js, so it's off.
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
		// Runs second; cleaning here would wipe dist/cli.js.
		clean: false,
		// tsconfig.base.json sets `incremental`, which the dts emit refuses
		// without a tsBuildInfoFile. That file ships as the core-typescript
		// template, so the override lives here.
		dts: { compilerOptions: { incremental: false } },
		shims: false,
	},
]);
