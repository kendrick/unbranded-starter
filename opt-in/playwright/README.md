# opt-in: Playwright + axe-core

Mobile-first device matrix with axe-core integration. Pattern lifted from `for-coleman`.

## When to use

- Any project that needs integration / e2e testing.
- Especially: anything mobile-first, anything with hard a11y requirements (WCAG 2.2 AA).

## Setup

1. Install:
   ```sh
   pnpm add -D @playwright/test @axe-core/playwright
   pnpm exec playwright install --with-deps
   ```
2. Copy `playwright.config.ts` to repo root.
3. Create `tests/integration/` directory.
4. Add scripts to `package.json`:
   ```json
   {
   	"scripts": {
   		"test:e2e": "playwright test"
   	}
   }
   ```

## Example test with axe-core

```ts
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('home page passes axe-core WCAG 2.2 AA', async ({ page }) => {
	await page.goto('/');
	const results = await new AxeBuilder({ page }).analyze();
	expect(results.violations).toEqual([]);
});
```

## Choosing the port

The config reads `E2E_PORT` once and uses it for `baseURL`, the `webServer` port, and the `PORT` it hands the dev server. When `E2E_PORT` is unset or empty, the port is 3000. A value that isn't an integer from 1 to 65535 throws when the config loads. The config never reads `PORT` from your shell, so a stray `PORT` can't move the tests.

To run two worktrees at once, give each its own port:

```sh
E2E_PORT=3101 pnpm exec playwright test
```

The dev server has to listen on that port. `next dev` reads `PORT` from the environment, so it follows `E2E_PORT` with no changes. Vite ignores `PORT` and needs a flag, so change `webServer.command` to pass it:

```ts
command: `pnpm dev --port ${port}`,
```

Locally, `reuseExistingServer` is on (it's off in CI). If something already answers on the port, Playwright skips starting a server and tests whatever is there, which can be another worktree's dev server running different code. Give each worktree its own `E2E_PORT`, or stop the other server first.

## CI integration

Uncomment the Playwright steps in `.github/workflows/ci.yml`:

```yaml
- name: Install Playwright browsers
  run: pnpm exec playwright install --with-deps chromium webkit
- name: Integration tests (mobile profile)
  run: pnpm test:e2e --project=mobile-chrome --project=mobile-safari
```
