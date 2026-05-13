import { defineConfig } from 'tsup';

export default defineConfig({
	entry: { cli: 'src/cli.ts' },
	format: ['esm'],
	target: 'node24',
	platform: 'node',
	clean: true,
	dts: false,
	banner: { js: '#!/usr/bin/env node' },
	shims: false,
});
