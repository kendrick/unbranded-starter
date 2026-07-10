```
◦◦    ◦◦ ◦◦    ◦◦ ◦◦◦◦◦◦◦  ◦◦◦◦◦◦◦     ◦◦    ◦◦    ◦◦ ◦◦◦◦◦◦   ◦◦◦◦◦◦◦◦ ◦◦◦◦◦◦
◦◦    ◦◦ ◦◦◦   ◦◦ ◦◦   ◦◦  ◦◦   ◦◦    ◦◦◦◦   ◦◦◦   ◦◦ ◦◦   ◦◦  ◦◦       ◦◦   ◦◦
◦◦    ◦◦ ◦◦◦◦  ◦◦ ◦◦   ◦◦  ◦◦   ◦◦   ◦◦  ◦◦  ◦◦◦◦  ◦◦ ◦◦    ◦◦ ◦◦       ◦◦    ◦◦
◦◦    ◦◦ ◦◦ ◦◦ ◦◦ ◦◦◦◦◦◦◦  ◦◦◦◦◦◦◦  ◦◦    ◦◦ ◦◦ ◦◦ ◦◦ ◦◦    ◦◦ ◦◦◦◦◦◦   ◦◦    ◦◦
◦◦    ◦◦ ◦◦  ◦◦◦◦ ◦◦   ◦◦  ◦◦ ◦◦    ◦◦◦◦◦◦◦◦ ◦◦  ◦◦◦◦ ◦◦    ◦◦ ◦◦       ◦◦    ◦◦
◦◦    ◦◦ ◦◦   ◦◦◦ ◦◦   ◦◦  ◦◦  ◦◦   ◦◦    ◦◦ ◦◦   ◦◦◦ ◦◦   ◦◦  ◦◦       ◦◦   ◦◦
 ◦◦◦◦◦◦  ◦◦    ◦◦ ◦◦◦◦◦◦◦  ◦◦   ◦◦  ◦◦    ◦◦ ◦◦    ◦◦ ◦◦◦◦◦◦   ◦◦◦◦◦◦◦◦ ◦◦◦◦◦◦
                                               u n b r a n d e d ◦ s t a r t e r
```

# unbranded

[![npm version](https://img.shields.io/npm/v/unbranded.svg)](https://www.npmjs.com/package/unbranded)

Add your preferred tooling to any project, new or existing, using the package manager you already have.

Fifteen à la carte units, pinned for reproducibility, that merge into what's already there instead of overwriting it.

- [Why unbranded](#why-unbranded)
- [Quickstart](#quickstart)
- [What You Can Install](#what-you-can-install)
- [Beyond Day One](#beyond-day-one)
- [Commands and Flags](#commands-and-flags)
- [Non-Interactive Runs](#non-interactive-runs)
- [Preview a Run](#preview-a-run)
- [How It Works](#how-it-works)
- [Philosophy](#philosophy)

## Why unbranded

Most scaffolders are a one-time event. `create-next-app`, `create-t3-app`, and the rest generate a fresh project on day zero and then they're done. The config they leave behind is yours to maintain by hand forever after, and if you're not starting from scratch, they don't help at all.

But most of the repos you touch already exist, and the tooling questions never really stop. unbranded is built for that. It runs on a brand-new directory or a repo with ten thousand commits, adds only the units you pick, and keeps earning its keep long after the first run.

### What sets it apart

- **It works on repos that already exist.** Point it at a live project and it augments in place, folding into your `package.json` and config files rather than clobbering them. A real conflict stops for an overwrite-or-skip prompt with a diff.
- **It uses your package manager.** npm, pnpm, yarn, or bun, detected from your lockfile. No tool forces its own on you.
- **À la carte, not a monolith.** Pick the units you want and a resolver pulls in whatever they depend on, showing you the full set before it writes anything. No eject, no all-or-nothing template.
- **Reproducible by default.** Every version is pinned; `--latest` opts out per run, and any interactive run saves as a recipe to replay in CI or on the next project. Automation re-checks the pins weekly with `unbranded outdated` and opens per-unit bump PRs gated on that unit's tests, so reproducible never quietly goes stale.
- **It stays useful past day one.** Every run records what it wrote, so `unbranded diff` shows how far a project has drifted from its scaffold and `unbranded doctor` audits any repo and names the exact unit that closes each gap.

The name is the point: no framework lock-in, no house brand.

## Quickstart

```bash
npm create unbranded@latest     # or: pnpm create unbranded · bun create unbranded
```

Any of those drops you into the interactive flow. `npx unbranded` is the same thing without the launcher:

```bash
npx unbranded
```

In a hurry? Skip the picker and start from a shipped recipe:

```bash
npx unbranded --preset node-lib --pm pnpm
```

Run it inside a directory that already has a `package.json` and it augments that project in place; run it anywhere else and it asks for a project name, then creates and enters a new directory. Either way it detects your package manager from the lockfile (pnpm → bun → yarn → npm) and asks what to install.

A run looks roughly like this:

```
┌  unbranded
│
●  Target: ~/code/my-app (augment)
●  Package manager: pnpm
│
◇  What do you want to install?
│  [Foundation] EditorConfig
│  [Foundation] Node version pin
│  [Linting]    ESLint
│  [TypeScript] TypeScript
│  …
│
□  Plan
│  • ESLint
│  • TypeScript (auto)
│  2 units · 3 files · 7 deps · install via pnpm
│
◇  Apply? Yes
│
●  Files: 3 written, 0 overwritten, 0 merged, 0 appended, 0 skipped.
│
○  Installing dependencies via pnpm
│
└  Done.
```

## What You Can Install

Fifteen units, grouped by category. Selecting one can pull in others: ESLint implies TypeScript, PostCSS and shadcn/ui imply Tailwind, and the GitHub Actions unit implies the lint and test units its workflow runs. Auto-added units are tagged `(auto)` in the plan.

**Foundation**

- **EditorConfig** — cross-editor whitespace and charset rules.
- **Git attributes** — normalizes line endings to LF and marks the common binaries so diffs and merges stay clean.
- **Node version pin** — writes `.nvmrc`, `engines.node`, and the Corepack `packageManager` field from your running toolchain, so all three agree instead of drifting apart.

**Linting**

- **ESLint** — `@antfu/eslint-config` in a base, react, or next flavor. Base is TypeScript-only, for Node libraries and CLIs; react and next layer on React, hooks, and a strict jsx-a11y block, and next adds Next's performance rules. Tabs, single quotes, arrow parens, with dprint formatting the non-code files.

**TypeScript**

- **TypeScript** — the full strict suite plus `noUncheckedIndexedAccess` and the rest.

**Styles**

- **Stylelint** — standard config with a Tailwind-aware preset.
- **Tailwind v4** — no JS config; add `@import "tailwindcss";` to your stylesheet.
- **PostCSS** — a one-line config that loads `@tailwindcss/postcss`.

**Testing**

- **Vitest** — jsdom environment with the common excludes.

**End-to-end**

- **Playwright + axe** — mobile-first device matrix with `@axe-core/playwright` wired up.

**UI**

- **shadcn/ui** — `components.json` plus the `cn()` utility at `src/lib/utils.ts`.

**Git hooks**

- **Husky + lint-staged** — a pre-commit hook that runs lint-staged on changed files.

**Editor**

- **VS Code workspace** — `settings.json` merged into whatever you already have, plus an `extensions.json` generated from the units you picked.

**CI**

- **GitHub Actions** — a workflow that runs install, lint, typecheck, and test on push and pull request.

**Monorepo**

- **pnpm workspace + Turbo** — workspace yaml with build-script approvals for esbuild/sharp/unrs-resolver (pnpm 10 and 11) and a turbo.json baseline.

Run `unbranded list` for the same catalog in your terminal, or `unbranded list --json` to hand it to other tooling.

### Presets

Three shipped recipes bundle the common answers, and the interactive flow offers them as a starting point before the picker:

- **node-lib** — a typed, tested, linted Node library: strict TypeScript, ESLint (base flavor), Vitest, pre-commit hooks, CI, and the editor/git hygiene units.
- **next-app** — everything node-lib has plus the front-end stack: Tailwind v4, PostCSS, Stylelint, shadcn/ui, Playwright with axe, and a shared VS Code workspace, with ESLint on the next flavor.
- **cli** — node-lib without the git hooks, for command-line tools.

`--preset <name>` behaves like `--config` pointed at the bundled file, with one twist: `--units` _adds_ to a preset instead of replacing its list, because a preset is a starting point. Presets default to the safe run (no install, no overwrites); pass `--pm` to install and `--on-conflict overwrite` to clobber. The files live in [presets/](presets/) as plain recipe JSON, so they double as documentation.

## Beyond Day One

The pieces that make unbranded worth keeping in a repo rather than running once and forgetting. Each is read-only unless noted, needs no TTY, and speaks `--json`, so it sits in CI as comfortably as at your prompt.

- **`unbranded diff`** compares your tracked files against the recorded state and labels each unchanged, user-modified, template-updated, or both. It exits non-zero on drift, so it drops straight into a CI check. `--diff` for the patch, `--json` for tooling.
- **`unbranded doctor`** audits any repo, whether unbranded scaffolded it or not: missing config, coexisting lockfiles, absent version pins, and more, each named with the unit or command that closes it. It writes nothing; `--strict` turns findings into a non-zero exit.
- **`unbranded doctor --fix`** hands the fixable findings to the apply pipeline, opening the picker with those units preselected (or applying them outright with `--fix --yes`). Findings no unit can close are printed as manual steps, never run.
- **`unbranded update`** three-way merges newer template versions into your tracked files against their recorded baseline: untouched files update silently, non-overlapping edits merge, and a real conflict asks per file. `--strategy <ours|theirs|markers>` answers globally for CI.
- **`unbranded outdated`** grades every manifest pin against the npm registry (patch, minor, major). It exits 0 by default so a report never fails a job; `--strict` gates on majors, `--registry` points at a mirror.
- **`unbranded remove <unit>`** backs a unit out: it deletes the unit's unmodified files, drops the package.json entries no remaining unit still claims, and refuses to strand a dependent unless you pass `--cascade`. `--dry-run` previews the whole thing.

Every run records what it wrote in `.unbranded.json` plus an `.unbranded/` sidecar of byte-exact baselines (the merge base `update` needs), so commit both. Doctor findings are opinions, and some won't apply to your repo; accept one by adding its id to a `doctor.ignore` array in the state file. The full non-interactive contract, the JSON schemas under `schemas/`, and the agent loop end to end live in [AGENTS.md](AGENTS.md) and [docs/agent-cookbook.md](docs/agent-cookbook.md).

## Commands and Flags

```
unbranded                interactive prompt flow (the default)
unbranded list           print the unit catalog
unbranded diff           report drift against the recorded state
unbranded doctor         audit the current repo
unbranded update         three-way merge newer templates into tracked files
unbranded outdated       grade manifest pins against the npm registry
unbranded remove <unit>  back a tracked unit out
```

The flags you'll reach for most, with `unbranded --help` for the full set:

| Flag                          | Does                                                          |
| ----------------------------- | ------------------------------------------------------------- |
| `--config, -c <file>`         | run a JSON recipe non-interactively                           |
| `--units <a,b,c>`             | pick units inline, no recipe file                             |
| `--pm <npm\|pnpm\|yarn\|bun>` | set the package manager and skip detection                    |
| `--yes`                       | apply without the confirm prompt (needs `--units`/`--config`) |
| `--dry-run`                   | resolve and report, write nothing                             |
| `--latest`                    | take the newest versions, not the pins                        |
| `--target <dir>`              | scaffold against `<dir>` instead of the current directory     |

`--help` covers the rest, including `--force`, `--json`, `--fix`, `--cascade`, `--strategy`, and `--registry`.

## Non-Interactive Runs

For CI and reproducible setups, drive the whole flow from a recipe:

```bash
unbranded --config recipe.json
```

```json
{
	"units": ["core-eslint", "core-vitest"],
	"pm": "pnpm",
	"onConflict": "overwrite",
	"postInstall": "all",
	"projectName": "my-app"
}
```

`units`, `pm` (or `null` to skip install), `onConflict`, and `postInstall` are required; `projectName` only in new-project mode, and an unknown unit id fails validation immediately. Config mode skips the Apply confirmation, and inline flags like `--units`/`--pm` override the matching recipe field when both are set.

Don't want to hand-write the JSON? Finish an interactive run and it offers to save your choices as `recipe.json`, so you explore once and replay everywhere. The full recipe schema and the exit-code contract (`0` success, `1` any error or `--strict` gate, `130` for Ctrl-C at a prompt) are documented in [AGENTS.md](AGENTS.md).

## Preview a Run

`--dry-run` resolves the whole plan and prints what each file would do, then stops before writing a byte or touching the package manager. It works with or without `--config`.

```bash
unbranded --dry-run
unbranded --dry-run --diff   # add the unified patch for every file that would change
```

Every file gets one verdict: `would create`, `would merge`, `would append`, `identical`, or `conflict`. The closing summary mirrors a real run's `Files:` line, reworded as `Would:`.

## How It Works

1. **Target detection.** A `package.json` in the current directory means augment mode; otherwise the CLI asks for a name and works in a new directory it creates.
2. **Package manager detection.** It walks up for a lockfile, then falls back to the `packageManager` field, then `npm_config_user_agent`, then a prompt. With no `package.json` at all, it writes files, skips install, and prints a next-steps block.
3. **Selection and resolution.** A category-grouped multiselect feeds a resolver that closes the set under `implies`, validates `requires`, and fails fast on an `excludes` violation.
4. **Guardrails.** In a git repo with a dirty working tree it warns before writing anything, since a clean tree is your undo button (`git checkout .`). `--force` skips the check.
5. **Apply.** Existing files prompt for overwrite or skip with a colored diff. Structured units fold into `package.json`, `settings.json`, and ignore files rather than overwriting, and the run records what landed in `.unbranded.json`.
6. **Install and hooks.** The detected package manager runs under a Ctrl-C trap, then per-unit post-install steps (like `husky init`, gated on a real `.git/`) prompt with sensible defaults.

## Requirements

Node 22 or newer.

## Philosophy

- **`@antfu/eslint-config` over `eslint-config-next`** alone. @antfu gives uniform style, a11y, and formatting across every kind of project, not just Next ones.
- **Tabs over spaces**, because @antfu does tabs and I'm not picking that fight.
- **Strict TypeScript is non-negotiable.** `noUncheckedIndexedAccess` catches the bugs the basic `strict` flag misses.
- **`.vscode/` is committed**, and there's a unit for it. If you work in VS Code, a clone should just work.

## Manual Clone

The CLI is the recommended path, but the repo doubles as a template if you'd rather hand-pick files:

```bash
pnpm dlx degit kendrick/unbranded-starter new-project
```

Then take what you want from the root configs and the `opt-in/` directories.

## License

[MIT](./LICENSE).
