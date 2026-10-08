# opt-in: husky + lint-staged

Pre-commit hook that runs your lint unit's fixers (oxlint and oxfmt, or ESLint) plus Stylelint on staged files only. Pattern adapted from `nextera-livewire`.

## When to use

- Client work, shared repos, anywhere multiple people commit.
- Skip for solo projects unless you want it.

## Setup

1. Install:
   ```sh
   pnpm add -D husky lint-staged
   ```
2. Copy `.husky/` to the repo root. `unbranded` generates `lint-staged.config.mjs` from the lint unit you picked; setting it up by hand, point each glob at your linter's `--fix` command.
3. Initialize husky:
   ```sh
   pnpm exec husky init
   chmod +x .husky/pre-commit
   ```
4. Add to root `package.json`:
   ```json
   {
   	"scripts": {
   		"prepare": "husky"
   	}
   }
   ```

## Optional: commitizen + conventional commits

If you also want commitizen for `cz` shortcut:

```sh
pnpm add -D commitizen cz-conventional-changelog
```

Add to root `package.json`:

```json
{
	"scripts": {
		"cz": "cz"
	},
	"config": {
		"commitizen": {
			"path": "./node_modules/cz-conventional-changelog"
		}
	}
}
```
