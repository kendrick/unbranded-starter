# unbranded-starter

A personal template repo. Fork (or `cp -r`) when starting a new project. Carries the canonical config set I use across all my work, plus opt-in modules for common shapes (monorepo, pre-commit hooks, Playwright + axe, shadcn/ui).

Aligns with [`unbranded-ds`](../unbranded-ds) — same design-system author, same toolchain conventions.

## What's in here

### Core (always applied to a new project)

| File                       | What it does                                                                                                                                                                                                                                                                                    |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.nvmrc`                   | Pins Node 22 LTS. Auto-switched by nvm / fnm / asdf / proto.                                                                                                                                                                                                                                    |
| `.editorconfig`            | Cross-editor tab/EOL/charset/newline. Covers editors that don't run Prettier on save.                                                                                                                                                                                                           |
| `eslint.config.mjs`        | `@antfu/eslint-config` base with `react: true, nextjs: true, typescript: true`. **The source of truth for formatting** — tabs, single quotes, arrow-always parens, plus correctness rules and jsx-a11y strict block (28 rules). Handles JS/TS/JSON/MD/YAML/CSS/HTML via `eslint-plugin-format`. |
| `stylelint.config.mjs`     | `stylelint-config-standard` + `@dreamsicle.io/stylelint-config-tailwindcss`. Tailwind v4 directives allowed.                                                                                                                                                                                    |
| `tsconfig.base.json`       | `ES2022`, `bundler` resolution, full strict suite + `noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters`, `verbatimModuleSyntax`, `noImplicitReturns`, `noFallthroughCasesInSwitch`.                                                                                              |
| `postcss.config.mjs`       | One-liner — `@tailwindcss/postcss`.                                                                                                                                                                                                                                                             |
| `package.json`             | Scripts (`dev`, `build`, `test`, `lint`, `lint:fix`, `typecheck`), `engines`, `packageManager`. Skeleton; project customizes. No `format` script — `@antfu` does formatting through `lint`.                                                                                                     |
| `vitest.config.ts`         | Baseline (jsdom, globals, common excludes).                                                                                                                                                                                                                                                     |
| `.vscode/settings.json`    | Format on save via ESLint (since `@antfu` handles formatting). Stylelint for CSS. Tab settings.                                                                                                                                                                                                 |
| `.vscode/extensions.json`  | Recommended extensions: ESLint, Stylelint, Tailwind IntelliSense, MDX.                                                                                                                                                                                                                          |
| `.github/workflows/ci.yml` | Baseline pipeline — typecheck → lint → test → build.                                                                                                                                                                                                                                            |
| `.gitignore`               | Comprehensive. Originally consolidated from `for-coleman`.                                                                                                                                                                                                                                      |

### Opt-in (copy in if/when you need it; sitting in `opt-in/` does nothing)

| Module                    | When to use                                                                                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `opt-in/monorepo/`        | `pnpm-workspace.yaml` (with `onlyBuiltDependencies` for `esbuild`/`sharp`/`unrs-resolver`) + `turbo.json`. Copy to root when starting a monorepo. |
| `opt-in/husky-precommit/` | Husky + lint-staged. For client work and shared repos. Skip for solo projects unless you want it.                                                 |
| `opt-in/playwright/`      | Mobile-first device matrix + `@axe-core/playwright`. Drop in when a project needs e2e or a11y testing.                                            |
| `opt-in/shadcn/`          | `components.json` + `lib/utils.ts` `cn()`. Drop in when scaffolding shadcn components.                                                            |

## Usage

```bash
# Option 1 — copy
cp -r ~/repos/unbranded-starter ~/repos/new-project
cd ~/repos/new-project
rm -rf .git
git init

# Option 2 — degit (after pushing to GitHub)
pnpm dlx degit user/unbranded-starter new-project
```

Then in the new project:

1. Edit `package.json` — set `name`, install deps (`pnpm add -D @antfu/eslint-config eslint stylelint prettier typescript ...` — see `package.json` for the canonical dep list).
2. `pnpm install`
3. Verify: `pnpm typecheck && pnpm lint`
4. Copy any `opt-in/` modules you need into the right place (see each module's own README).

## Philosophy

- **`@antfu/eslint-config` over `eslint-config-next`** alone, because it gives uniform style + a11y + formatting across all my work, not just Next projects.
- **Tabs over spaces** because @antfu does tabs and consistency wins.
- **`@antfu` does the formatting for code; Prettier is scoped to markdown only.** `@antfu/eslint-config` bundles `eslint-plugin-format` (dprint) for JS/TS/JSON/YAML/CSS/HTML. Prettier disagrees with dprint on small persistent things (quote handling, key quoting), so running both on code produces oscillation. We picked `@antfu` because 4 of 5 of my existing repos already use it. `pnpm lint` is the single source of truth for code; CI runs it. Editor format-on-save is wired to ESLint for code, Prettier for markdown only (via `.vscode/settings.json` per-language formatters) because Prettier's prose-wrap and list reflow are noticeably better than dprint's. Markdown isn't in CI — it's an editor-only formatter for now. `.editorconfig` covers basics for editors without an ESLint integration.
- **Stylelint exists** even on tiny projects. The same config works everywhere.
- **Strict TypeScript is non-negotiable.** `noUncheckedIndexedAccess` catches the bugs the basic `strict` flag misses.
- **`.vscode/` is committed.** I work in VS Code; a clone should "just work."
- **Mobile-first when testing.** Opt-in Playwright config defaults to Pixel + iPhone profiles.
