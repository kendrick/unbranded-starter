import { defineConfig } from 'tsup';

export default defineConfig([
	// Cleans first so the index build (below) isn't wiped by this one running
	// second. The shebang banner is scoped to this config alone—it must not
	// land on dist/index.js, since that file is `require`/`import`-ed as a
	// library, not executed as a script.
	{
		entry: { cli: 'src/cli.ts' },
		format: ['esm'],
		target: 'node22',
		platform: 'node',
		clean: true,
		dts: false,
		banner: { js: '#!/usr/bin/env node' },
		shims: false,
	},
	{
		entry: { index: 'src/index.ts' },
		format: ['esm'],
		target: 'node22',
		platform: 'node',
		clean: false,
		// tsconfig.base.json turns on `incremental`, which tsc refuses without a
		// tsBuildInfoFile when it emits declarations. That file ships as the
		// core-typescript template, so the override lives here rather than in a
		// config scaffolded projects inherit.
		dts: { compilerOptions: { incremental: false } },
		shims: false,
	},
]);
