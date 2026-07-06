# Project Overview

## What This Is

<!-- One sentence. What does this project do? -->

`unbranded` is an interactive CLI that scaffolds opinionated project tooling (ESLint, TypeScript, Tailwind, Vitest, Playwright, and more) into any directory using whichever package manager the user already has, then maintains what it wrote through the day-2 verbs (`diff`, `doctor --fix`, `update`, `remove`) keyed off the `.unbranded.json` state file and its `.unbranded/` baseline sidecar.

## Stack

- Language: TypeScript, ESM only. Bundled with tsup to a single `dist/cli.js` (target `node24`, shebang banner, no dts).
- Framework: none — it's a Node CLI. Interactive prompts via `@clack/prompts`, plus `@clack/core` (same pinned instance) for the custom filterable unit picker; unified-diff conflict rendering via `diff`; three-way merges for `update` via `node-diff3` (the fourth runtime dep, pinned, wrapped in `src/fs/merge3.ts`).
- Styling: n/a for the CLI itself. It _ships_ Tailwind v4 / Stylelint / PostCSS configs to user projects.
- Data layer: none.
- Deployment: published to npm as `unbranded`; `bin` maps to `dist/cli.js`; entry point is `npx unbranded`.

## Repository Structure

<!-- Top-level directory map. Update as the layout changes. -->

```
src/
  cli.ts            — arg parsing (node:util parseArgs): --config/-c, --help, --version, --no-color/--color; applyColorPolicy() at startup; top-level error catch
  commands/         — init.ts (runInit(): detect → select → resolve → plan → copy → install → post-install; returns { ok }); the day-2 verbs list/diff/doctor (--fix)/remove/update, each a pure planner + prompting shell
  config/load.ts    — --config recipe loader + validate() (JSON only in v1)
  detect/pm.ts      — package-manager detection (lockfile → packageManager field → user-agent → prompt)
  detect/target.ts  — augment-vs-new-project detection
  detect/installed.ts, detect/signals.ts — installed-unit badges + shared read-only repo probes (signals also feed doctor)
  fs/copy.ts        — per-file copy with conflict handling; merge-json.ts — package.json merge + removal; merge3.ts — three-way text merge (the node-diff3 wrapper)
  install/run.ts    — spawn PM install (SIGINT trap); post.ts — per-unit post-install hooks
  manifest/         — types.ts (core contracts), index.ts (the UNITS registry), resolve.ts (implies/requires/excludes), options.ts + eslint-config.ts (declarative unit options + generated eslint flavors)
  prompts/unit-picker/ — filterable multi-select prompt: pure option/state/render core + a thin @clack/core shell (prompt.ts)
  state/state.ts    — the .unbranded.json envelope (STATE_SCHEMA 2) + .unbranded/ baseline sidecar; the three state doors (writeStateFile grows, applyRemovalToState shrinks, refreshTrackedFiles refreshes)
  util/paths.ts     — PKG_ROOT anchor (walk-up to package.json); util/color.ts — one shared color policy (NO_COLOR/--color) the diff, picker, and clack all honor
  **/*.spec.ts      — unit tests co-located next to source
templates/          — files needing runtime interpolation/rename before copy (e.g. tsconfig.json)
opt-in/             — source payloads for opt-* units (husky, monorepo, playwright, shadcn)
test/e2e/           — E2E specs + fixtures (expected-pack.txt is the tarball snapshot); npm-pack.ts shares defensive `npm pack --json` parsing
scripts/            — working-memory-kit session hooks (.sh + .ps1)
```

## Key Constraints

<!-- Non-obvious things an agent must know: monorepo rules, legacy code -->
<!-- boundaries, API version requirements, browser support, etc. -->

- **Node 24+ required.** `src/util/paths.ts` relies on `import.meta.dirname`; `engines.node` is `>=24` and tsup targets `node24`.
- **Dual-purpose repo.** The root config files (`eslint.config.mjs`, `tsconfig.base.json`, `stylelint.config.mjs`, `postcss.config.mjs`, `vitest.config.ts`, `.editorconfig`, `.nvmrc`) plus everything under `opt-in/` and `templates/` are BOTH this repo's own tooling AND the payload the CLI copies into user projects. Editing them changes what end users receive. `package.json#files` is what actually ships.
- **Manifest `src` paths are `PKG_ROOT`-relative and posix-style.** The runtime joins to native paths and copies as buffers, so the same manifest works from `src/` (tests, `tsup --watch`), from `dist/`, and from inside `node_modules/unbranded/`.
- **Dependency versions are pinned exactly** in `manifest/index.ts` for reproducibility.
- **npm strips top-level `.gitignore` from tarballs**, so files that need to land as dotfiles use `FileOp.rename` (ship as `*.template`, rename on copy).
- **State changes go through the three doors in `src/state/state.ts`.** `writeStateFile` only grows the tracked set (it merges with the prior envelope), `applyRemovalToState` is the only shrink, `refreshTrackedFiles` is `update`'s hash/baseline refresh. Copy-mode writes must keep the `.unbranded/baseline/` sidecar in sync — it's `update`'s merge base and ships in every scaffold.
