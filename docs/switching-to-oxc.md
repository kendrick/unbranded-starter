# Switching an ESLint Project to oxlint

This is for projects scaffolded with `core-eslint`, which includes anything an older preset generated before `core-oxlint` became the default. Follow it to swap ESLint for oxlint and oxfmt. The TypeScript line is a separate choice on `core-typescript`, so the swap leaves `typescript` on 6.x, and moving to 7 is an optional step at the end.

## What Doesn't Change on Its Own

`update` keeps pulling template changes, and it keeps `typescript` on the 6.x line your project declares. `core-eslint` requires that line: typescript-eslint peers `typescript <6.1.0`, and the main entry point of TypeScript 7 exports no `createProgram` for it to load. `--units core-typescript:7,core-eslint` exits 1 and names typescript-eslint. Your ESLint setup keeps working, and you can stay on it indefinitely.

## Why Switch, and Why Not To

Switching gets you the oxc toolchain: `oxlint` for linting and `oxfmt` for formatting. It also lifts the TypeScript 6 limit, so you can move to TypeScript 7 afterward.

Stay on ESLint if you depend on ESLint plugins or rules that oxlint doesn't cover. The switch deletes `eslint.config.mjs` and its `@antfu/eslint-config` setup, and your custom rules don't carry over.

## Before You Start

Commit or stash your work. The steps below change `package.json`, delete files, and reformat your tree, so you want a clean baseline to review against.

Before you remove anything, write down which units the project has. Each entry in the `units` array of `.unbranded.json` names one by its `id`. Step 1's cascade drops units from that file, and step 2 needs the original list.

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

2. Add `core-oxlint`, and add back every unit you had whose files call ESLint. That is `opt-ci-github`, which the cascade removed, and `opt-husky`, whose `lint-staged.config.mjs` runs `eslint --fix` until you regenerate it. Add `core-typescript:6` to pin the line explicitly. The run installs `oxlint` and `oxfmt` and leaves `typescript` on 6.x. Preview it first, because the command overwrites differing files:

   ```bash
   npx unbranded --units core-typescript:6,core-oxlint,opt-ci-github,opt-husky --pm pnpm --yes --dry-run --diff
   ```

   Every `conflict` entry is a file you changed, and the diff shows what the run would replace. Run it for real once you've read them:

   ```bash
   npx unbranded --units core-typescript:6,core-oxlint,opt-ci-github,opt-husky --pm pnpm --yes
   ```

   Drop `opt-ci-github` or `opt-husky` from `--units` if you didn't have it. Replace `pnpm` with your package manager.

   Don't add `--on-conflict skip` to protect your edits. It also keeps the existing `typescript` pin when you later move to 7. Instead, restore the files you customized from your baseline commit. This example restores two of them:

   ```bash
   git checkout -- .husky/pre-commit .github/workflows/ci.yml
   ```

   Neither file calls ESLint, so your versions work unchanged. A customized `lint-staged.config.mjs` is different, because it has to change. Restore it the same way, then replace each `eslint --fix` with the commands a fresh scaffold writes:

   ```js
   '*.{js,mjs,cjs,ts,tsx,jsx}': ['oxlint --no-error-on-unmatched-pattern --fix', 'oxfmt --no-error-on-unmatched-pattern'],
   '*.{json,md,mdx,yaml,yml}': ['oxfmt --no-error-on-unmatched-pattern'],
   ```

   If you have `opt-vscode`, edit `.vscode/settings.json` by hand, because re-selecting the unit leaves it untouched. Delete `source.fixAll.eslint`, `eslint.useFlatConfig`, and the `editor.defaultFormatter` entry that names `dbaeumer.vscode-eslint`. Then delete `dbaeumer.vscode-eslint` from `.vscode/extensions.json`. Adding `opt-vscode` to step 2's `--units` puts `oxc.oxc-vscode` in `extensions.json`, but the CLI doesn't write oxc settings into `settings.json` yet, so add the extension's formatter and fix-on-save settings by hand if you want format-on-save.

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

The version starts with `6.`.

After `pnpm format`, `npx unbranded diff` lists the rewritten files as user-modified. Judge the switch by lint and typecheck.

## Moving to TypeScript 7

This is a separate step. Do it once the oxlint swap is committed and green, so a lint failure and a compiler failure never arrive together. Re-select `core-typescript` with the new line:

```bash
npx unbranded --units core-typescript:7,core-oxlint --pm pnpm --yes
```

Add your other units to `--units` if you want them re-rendered too. Then run `pnpm lint && pnpm typecheck` again, and check that `grep '"typescript"' package.json` starts with `7.`.
