# Conventions

<!-- Project-specific patterns agents must follow. -->
<!-- This is the "how we do things here" file. -->

## Naming

- Unit ids are kebab-case with a domain prefix: `core-*` for baseline tooling, `opt-*` for optional add-ons. Adding a unit means extending both the `UnitId` union and the `UNITS` array.
- Files are kebab-case. ESM only, `.ts` source, `.mjs` for shipped config files.
- The `camelcase` ESLint rule runs with `properties: 'never'` on purpose — snake_case is allowed in data shapes (env keys like `npm_config_user_agent`, external API/config payloads), but identifiers still get policed.

## File Organization

- Source is grouped by concern under `src/`: `detect/`, `fs/`, `install/`, `manifest/`, `config/`, `commands/`, `prompts/`, `util/`.
- Unit tests are co-located as `*.spec.ts` next to the file they cover. End-to-end tests live in `test/e2e/` and run under a separate Vitest config (`vitest.e2e.config.ts`, which builds first).
- **A new heavy real-install e2e spec must self-skip under `UB_E2E_LEG=main` and get its own CI job.** The three real installs in `eslint-flavors.spec` (one per flavor, keyed off `UB_FLAVOR`) and `scaffold-lint.spec` dominate e2e wall-clock, so `ci.yml` runs each in a parallel job while `e2e-main` runs everything else with those specs skipped. A heavy spec that lands on the `e2e-main` critical path puts the sum back on the clock.

## Core Patterns

- **Pure core, async shell.** Detection and resolution split a pure, side-effect-free function (`inspectPm`, `inspectTarget`, `resolveSelection`) from an async wrapper that prompts (`detectPm`, `detectTarget`). Tests exercise the pure half against fixtures without mocking `@clack/prompts`. Follow this split for any new detect/resolve logic. The unit picker follows it too: pure option/state/render modules plus a `translateKey` table, with only `UnitPickerPrompt` touching `@clack/core`, so the whole prompt is testable without a terminal.
- **Manifest is data.** Behavior differences between units are expressed as declarative fields (`implies`, `requires`, `excludes`, `files`, `postInstall`, `packageJsonPatch`), not branching code. Prefer adding a field over special-casing a unit in the runtime.
- **Everything unbranded writes into a scaffold must pass the config it ships.** A fresh scaffold's own `eslint .` has to come back clean with no `--fix` pass, so `package.json` merges to antfu's exact `sortPackageJson` key order (`type` before `version`, `packageManager`/`private` before `description`) and seeds tab-indented, and `.unbranded.json` is written tab-indented. `test/e2e/scaffold-lint.spec.ts` is the regression net.
- **All ANSI goes through the shared color policy.** Read `colorEnabled()` (`src/util/color.ts`) before emitting escapes — never hardcode them — so `NO_COLOR`/`--no-color`/`--color` and piped-output-stays-plain hold everywhere at once.
- **Package-manager spawns go through `spawnOptions()`** (`src/install/spawn.ts`). It sets `shell: true` on Windows so `.cmd` shims execute, since bare `spawn` can't run them. Any new code that spawns a PM must use it.
- **Comments explain WHY.** This codebase is a strong exemplar — comments cover the constraint that forced the shape, not what the code does. Match that bar.
- **Style (enforced by `@antfu/eslint-config`):** tabs, single quotes, semicolons, arrow parens always. `pnpm lint` (ESLint) is the only formatter CI runs for code.

## Error Handling

- Throw `Error` with an actionable message. `src/cli.ts` has a top-level catch that renders it via `clack log.error` and exits 1 — no raw stack traces reach users.
- Fail loudly on ambiguity that would confuse later: `detectPm` throws for a malformed `package.json` and for `workspace-leaf`; `validate()` throws for bad recipes.
- User aborts route through `cancelAndExit()` (`src/util/cancel.ts`): it prints the cancel banner and exits 130 (the SIGINT convention, 128 + 2), never an error. Every `isCancel()` branch calls it. Answering No at the Apply prompt exits 0, since that's a choice rather than an abort.
