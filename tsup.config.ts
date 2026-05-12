import { defineConfig } from 'tsup';

export default defineConfig({
	entry: { cli: 'src/cli.ts' },
	format: ['esm'],
	target: 'node20.11',
	platform: 'node',
	clean: true,
	dts: false,
	banner: { js: '#!/usr/bin/env node' },
	shims: false,
});
