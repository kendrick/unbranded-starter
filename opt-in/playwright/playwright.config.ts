import { defineConfig, devices } from '@playwright/test';

// Per-worktree port: two worktrees sharing a port make reuseExistingServer test the other branch's server. Reads E2E_PORT only, since a framework's own PORT leaks in from the shell.
const rawPort = process.env.E2E_PORT || '3000';
const port = Number(rawPort);
// The regex rejects " 3101", "0x0BB8", "3e3" and "3101.0", which Number() alone would accept.
if (!/^\d+$/.test(rawPort) || port < 1 || port > 65535)
	throw new Error(`E2E_PORT must be an integer from 1 to 65535, got "${rawPort}"`);

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
