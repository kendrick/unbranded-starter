# Antipatterns

<!-- Negative knowledge. Things the team tried that didn't work, captured so   -->
<!-- agents and humans don't re-litigate closed loops. Append-only, like        -->
<!-- decisionLog.md.                                                            -->
<!--                                                                            -->
<!-- Format: -->
<!-- ## YYYY-MM-DD — [Short title in imperative voice — what to avoid]         -->
<!-- **Tried:** What was attempted                                              -->
<!-- **What broke:** Observed failure mode                                      -->
<!-- **Why we backed out:** Root cause if known; otherwise the observed pain    -->
<!-- **Don't suggest:** Specific things agents should not re-propose            -->
<!--                                                                            -->
<!-- The last line is the agent-targeted lever. Be specific. "Don't suggest    -->
<!-- moving X to Y" beats "don't suggest big refactors."                       -->

## 2026-07-01 — Don't re-enable `pnpm/yaml-enforce-settings`

**Tried:** Leaving `eslint-plugin-pnpm`'s `pnpm/yaml-enforce-settings` rule at its default (on) in the shipped `eslint.config.mjs`.
**What broke:** On `--fix` the rule injects `trustPolicy: no-downgrade` into `pnpm-workspace.yaml`, and pnpm then rejects the lockfile.
**Why we backed out:** The CLI ships this config into user monorepos; the rule would corrupt every generated workspace's lockfile.
**Don't suggest:** Re-enabling `pnpm/yaml-enforce-settings`, or "just remove the override" in `eslint.config.mjs`. (commit 10777d7)

## 2026-05-12 — Don't put `markdown` back in `eslint.validate`

**Tried:** Including `"markdown"` in the VS Code `eslint.validate` array so the editor formats `.md` through ESLint.
**What broke:** The ESLint extension loads the full antfu chain on every `.md` save and hangs the editor on "Getting code actions from 'ESLint'".
**Why we backed out:** Markdown is deliberately Prettier's job in-editor; ESLint's dprint still handles it via `pnpm lint` when needed.
**Don't suggest:** Adding `"markdown"` to `.vscode/settings.json` `eslint.validate`. (commit 9ee2639)

## 2026-05-12 — Don't run both Prettier and dprint on code

**Tried:** Using Prettier for code formatting alongside `@antfu/eslint-config`'s bundled dprint.
**What broke:** They disagree on persistent small things (quote handling, key quoting) and fight each other on every save/lint.
**Why we backed out:** One formatter per file type. ESLint (dprint) owns code; Prettier is scoped to markdown only.
**Don't suggest:** Adding Prettier for JS/TS/JSON/YAML/CSS, or a `.prettierrc` covering code. (README Philosophy)

## 2026-05-12 — Don't rely on antfu's auto-install for eslint peers

**Tried:** Shipping the eslint unit without its `react`/`nextjs` peer plugins, letting `@antfu/eslint-config` prompt to auto-install them.
**What broke:** CI has no TTY for the prompt, so ESLint fails to load entirely.
**Why we backed out:** The config opts into `react: true` / `nextjs: true`, which hard-require those peers at load time.
**Don't suggest:** Removing the explicit peer deps from the `core-eslint` unit's `devDependencies` in `src/manifest/index.ts`. (commit fff58b4)
