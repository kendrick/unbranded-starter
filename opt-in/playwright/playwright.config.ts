import { defineConfig, devices } from '@playwright/test';

// Per-worktree port: two worktrees sharing one port make reuseExistingServer
// test the other branch's server. Reads E2E_PORT only; a framework's own PORT
// would leak in from the shell.
const raw = process.env.E2E_PORT;
const port = raw === undefined || raw === '' ? 3000 : Number(raw);
if (!Number.isInteger(port) || port < 1 || port > 65535)
	throw new Error(`E2E_PORT must be an integer from 1 to 65535, got "${raw}"`);

export default defineConfig({
	testDir: 'tests/integration',
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	reporter: process.env.CI ? 'github' : 'list',
	use: {
		baseURL: `http://localhost:${port}`,
		trace: 'on-first-retry',
	},
	webServer: {
		command: 'pnpm dev',
		port,
		env: { PORT: String(port) },
		reuseExistingServer: !process.env.CI,
		timeout: 120_000,
	},
	// Mobile-first matrix. Desktop included for parity but not run by default in CI.
	projects: [
		{ name: 'mobile-chrome', use: { ...devices['Pixel 5'] } },
		{ name: 'mobile-safari', use: { ...devices['iPhone 14'] } },
		{ name: 'desktop-chrome', use: { ...devices['Desktop Chrome'] } },
		{ name: 'desktop-firefox', use: { ...devices['Desktop Firefox'] } },
		{ name: 'desktop-safari', use: { ...devices['Desktop Safari'] } },
	],
});
