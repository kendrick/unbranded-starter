import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		environment: 'jsdom',
		globals: true,
		// Customize per project — these defaults are conservative.
		include: ['tests/unit/**/*.spec.ts', 'tests/unit/**/*.spec.tsx', 'src/**/*.spec.ts', 'src/**/*.spec.tsx'],
		exclude: ['**/node_modules/**', '**/dist/**', '**/.next/**', '**/build/**', '**/out/**'],
		// Uncomment if you have a setup file:
		// setupFiles: ['./tests/setup.ts'],
	},
	resolve: {
		alias: { '@': path.resolve(__dirname, '.') },
	},
});
