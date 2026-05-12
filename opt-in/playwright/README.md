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
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('home page passes axe-core WCAG 2.2 AA', async ({ page }) => {
	await page.goto('/');
	const results = await new AxeBuilder({ page }).analyze();
	expect(results.violations).toEqual([]);
});
```

## CI integration

Uncomment the Playwright steps in `.github/workflows/ci.yml`:

```yaml
- name: Install Playwright browsers
  run: pnpm exec playwright install --with-deps chromium webkit
- name: Integration tests (mobile profile)
  run: pnpm test:e2e --project=mobile-chrome --project=mobile-safari
```
