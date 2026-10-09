# Switching an ESLint Project to oxlint and TypeScript 7

This is for projects scaffolded with `core-eslint`, which includes anything an older preset generated before `core-oxlint` became the default. Follow it to swap ESLint for oxlint and oxfmt, and to move `typescript` from 6.x to 7.

## What Doesn't Change on Its Own

`update` keeps pulling template changes, but it holds `typescript` on 6.x for as long as `core-eslint` is installed. typescript-eslint peers `typescript <6.1.0`, and the main entry point of TypeScript 7 exports no `createProgram` for it to load. Your ESLint setup keeps working, and you can stay on it indefinitely.

## Why Switch, and Why Not To

Switching gets you TypeScript 7 and the oxc toolchain: `oxlint` for linting and `oxfmt` for formatting.

Stay on ESLint if you depend on ESLint plugins or rules that oxlint doesn't cover. The switch deletes `eslint.config.mjs` and its `@antfu/eslint-config` setup, and your custom rules don't carry over.

## Before You Start

Commit or stash your work. The steps below change `package.json`, delete files, and reformat your tree, so you want a clean baseline to review against.

## Steps

1. Remove `core-eslint`. If `opt-ci-github` is installed, the plain `remove` refuses, because its workflow runs `pnpm lint` and depends on `core-eslint` through the lint slot:

   ```bash
   npx unbranded remove core-eslint
   ```

   ```text
   unbranded remove: opt-ci-github depends on core-eslint. Remove it first, or re-run with --cascade to take the whole set out.
   ```

   Re-run it with `--cascade`. That removes `core-eslint` and every unit that depends on it, so `opt-ci-github` goes too, along with `.github/workflows/ci.yml`. Add `--dry-run` first to preview the plan.

   ```bash
   npx unbranded remove core-eslint --cascade --yes
   ```

   Without `opt-ci-github`, skip `--cascade`. The command deletes `eslint.config.mjs` if you haven't modified it, and drops `@antfu/eslint-config`, `eslint`, `eslint-plugin-format`, `lint`, and `lint:fix` from `package.json`. A file you've edited stays on disk and you delete it yourself.

2. Add `core-oxlint`, and add back every unit you had whose files call ESLint. That is `opt-ci-github`, which the cascade removed, and `opt-husky`, whose `lint-staged.config.mjs` runs `eslint --fix` until you regenerate it. This run also moves `typescript` to 7.x, installs `oxlint` and `oxfmt`, and rewrites the lint-staged config to call them:

   ```bash
   npx unbranded --units core-oxlint,opt-ci-github,opt-husky --pm pnpm --yes
   ```

   Drop `opt-ci-github` or `opt-husky` from `--units` if you didn't have it. Replace `pnpm` with your package manager. `opt-vscode` doesn't regenerate its `.vscode/settings.json`, so edit out the ESLint entries there by hand.

3. Format the tree once:

   ```bash
   pnpm format
   ```

   `pnpm format` reformats the whole tree once. oxfmt lays code out differently than the ESLint setup did, so expect a large diff. Commit the reformat by itself so `git blame` and your review stay readable.

## Check the Result

Run lint and typecheck:

```bash
pnpm lint && pnpm typecheck
```

Both exit 0. Then confirm the TypeScript line:

```bash
grep '"typescript"' package.json
```

The version starts with `7.`.

After `pnpm format`, `npx unbranded diff` lists the rewritten files as user-modified. Judge the switch by lint and typecheck.
