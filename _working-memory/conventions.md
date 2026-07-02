# Conventions

<!-- Project-specific patterns agents must follow. -->
<!-- This is the "how we do things here" file. -->

## Naming

- Unit ids are kebab-case with a domain prefix: `core-*` for baseline tooling, `opt-*` for optional add-ons. Adding a unit means extending both the `UnitId` union and the `UNITS` array.
- Files are kebab-case. ESM only, `.ts` source, `.mjs` for shipped config files.
- The `camelcase` ESLint rule runs with `properties: 'never'` on purpose — snake_case is allowed in data shapes (env keys like `npm_config_user_agent`, external API/config payloads), but identifiers still get policed.

## File Organization

- Source is grouped by concern under `src/`: `detect/`, `fs/`, `install/`, `manifest/`, `config/`, `commands/`, `util/`.
- Unit tests are co-located as `*.spec.ts` next to the file they cover. End-to-end tests live in `test/e2e/` and run under a separate Vitest config (`vitest.e2e.config.ts`, which builds first).

## Core Patterns

- **Pure core, async shell.** Detection and resolution split a pure, side-effect-free function (`inspectPm`, `inspectTarget`, `resolveSelection`) from an async wrapper that prompts (`detectPm`, `detectTarget`). Tests exercise the pure half against fixtures without mocking `@clack/prompts`. Follow this split for any new detect/resolve logic.
- **Manifest is data.** Behavior differences between units are expressed as declarative fields (`implies`, `requires`, `excludes`, `files`, `postInstall`, `packageJsonPatch`), not branching code. Prefer adding a field over special-casing a unit in the runtime.
- **Package-manager spawns go through `spawnOptions()`** (`src/install/spawn.ts`). It sets `shell: true` on Windows so `.cmd` shims execute, since bare `spawn` can't run them. Any new code that spawns a PM must use it.
- **Comments explain WHY.** This codebase is a strong exemplar — comments cover the constraint that forced the shape, not what the code does. Match that bar.
- **Style (enforced by `@antfu/eslint-config`):** tabs, single quotes, semicolons, arrow parens always. `pnpm lint` (ESLint) is the only formatter CI runs for code.

## Error Handling

- Throw `Error` with an actionable message. `src/cli.ts` has a top-level catch that renders it via `clack log.error` and exits 1 — no raw stack traces reach users.
- Fail loudly on ambiguity that would confuse later: `detectPm` throws for a malformed `package.json` and for `workspace-leaf`; `validate()` throws for bad recipes.
- User aborts route through `cancelAndExit()` (`src/util/cancel.ts`): it prints the cancel banner and exits 130 (the SIGINT convention, 128 + 2), never an error. Every `isCancel()` branch calls it. Answering No at the Apply prompt exits 0, since that's a choice rather than an abort.
