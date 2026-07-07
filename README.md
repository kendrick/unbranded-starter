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

Add your preferred tooling to any project, new or existing, using the package manager you already have. Fifteen à la carte units, pinned for reproducibility, that merge into what's already there instead of overwriting it.

## Why unbranded

Most scaffolders are a one-time event. `create-next-app`, `create-t3-app`, and the rest generate a fresh project on day zero and then they're done. The config they leave behind is yours to maintain by hand forever after, and if you're not starting from scratch, they don't help at all.

But most of the repos you touch already exist, and the tooling questions never really stop. unbranded is built for that. It runs on a brand-new directory or a repo with ten thousand commits, adds only the units you pick, and keeps earning its keep long after the first run.

### What sets it apart

- **It works on repos that already exist.** Point it at a live project and it augments in place, folding into your `package.json` and config files rather than clobbering them. A real conflict stops for an overwrite-or-skip prompt with a diff.
- **It uses your package manager.** npm, pnpm, yarn, or bun, detected from your lockfile. No tool forces its own on you.
- **À la carte, not a monolith.** Pick the units you want and a resolver pulls in whatever they depend on, showing you the full set before it writes anything. No eject, no all-or-nothing template.
- **Reproducible by default.** Every version is pinned. `--latest` opts out per run, and you can save any interactive run as a recipe to replay in CI or on the next project. The pins themselves are kept fresh on a weekly cadence — automation checks them with `unbranded outdated` and opens per-unit bump PRs gated on that unit's tests — so reproducible never quietly becomes reproducibly old.
- **It stays useful past day one.** Every run records what it wrote, so `unbranded diff` can show how far a project has drifted from its scaffold and `unbranded doctor` can audit any repo and name the exact unit that closes each gap.

The name is the point: no framework lock-in, no house brand.

## Quickstart

```bash
npx unbranded
```

In a hurry? Skip the picker and start from a shipped recipe:

```bash
npx unbranded --preset node-lib --pm pnpm
```

Run it inside a directory that already has a `package.json` and it augments that project in place. Run it anywhere else and it asks for a project name, then creates and enters the new directory. It detects your package manager from the lockfile (pnpm → bun → yarn → npm), then asks what you'd like to install.

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

- **ESLint** — `@antfu/eslint-config` with React, Next.js, TypeScript, and a strict jsx-a11y block. Tabs, single quotes, arrow parens. Formats JS/TS/JSON/YAML/CSS/HTML through `eslint-plugin-format`.

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

- **pnpm workspace + Turbo** — workspace yaml (with `onlyBuiltDependencies` for esbuild/sharp/unrs-resolver) and a turbo.json baseline.

Run `unbranded list` for the same catalog in your terminal, or `unbranded list --json` to hand it to other tooling.

### Presets

Three shipped recipes bundle the common answers, and the interactive flow offers them as a starting point before the picker:

- **node-lib** — a typed, tested, linted Node library: strict TypeScript, ESLint (base flavor), Vitest, pre-commit hooks, CI, and the editor/git hygiene units.
- **next-app** — everything node-lib has plus the front-end stack: Tailwind v4, PostCSS, Stylelint, shadcn/ui, Playwright with axe, and a shared VS Code workspace, with ESLint on the next flavor.
- **cli** — node-lib without the git hooks, for command-line tools.

`--preset <name>` behaves like `--config` pointed at the bundled file, with one twist: `--units` _adds_ to a preset instead of replacing its list, because a preset is a starting point. Presets default to the safe run (no install, no overwrites); pass `--pm` to install and `--on-conflict overwrite` to clobber. The files live in [presets/](presets/) as plain recipe JSON, so they double as documentation.

## Beyond Day One

These are the pieces that make unbranded worth keeping in a repo rather than running once and forgetting:

- **`unbranded diff`** compares your tracked files against `.unbranded.json`, the state file every run records. It labels each file unchanged, user-modified, template-updated, or both, and exits non-zero when anything has drifted, so it drops straight into a CI check. Add `--diff` for the patch, `--json` for tooling.
- **`unbranded doctor`** audits any repo, whether unbranded scaffolded it or not. It flags missing config, coexisting lockfiles, absent version pins, and more, and names the unit or command that fixes each finding. It writes nothing. `--strict` turns findings into a non-zero exit so it doubles as a repo-hygiene gate.
- **`unbranded doctor --fix`** is the opt-in bridge from audit to remedy: it hands the fixable findings to the normal apply pipeline, opening the picker with those units preselected (or applying them outright with `--fix --yes`). Findings a unit can't close are listed as manual steps and never executed.
- **`unbranded update`** pulls newer template versions into your tracked files. Each file three-way merges against its recorded baseline: untouched files update silently, non-overlapping edits merge, and a true conflict asks per file whether to keep yours, take the template, or write conflict markers. `--strategy <ours|theirs|markers>` answers globally for CI, and a `--yes` run that hits a conflict without one fails instead of guessing. JSON files (package.json, merged settings) go through the structured merge, never a text merge.
- **`unbranded outdated`** checks every pinned version in the unit manifest against the npm registry and grades the gap (patch, minor, major). The default exit is always 0 so a report never fails a job; `--strict` exits non-zero when majors are behind, and `--json` feeds tooling. `--registry` points it at a mirror.
- **`unbranded remove <unit>`** backs a unit out: it deletes the unit's unmodified files (a file you edited gets a per-file prompt, and `--yes` keeps it), drops the package.json entries no remaining unit still claims, and updates the tracking. It refuses to strand a dependent — removing `core-tailwind` while `opt-shadcn` needs it is an error unless you pass `--cascade` to take the whole chain out. `--dry-run` previews everything.

Doctor's findings are opinions, and not every one is a defect on your repo. To accept a finding, add its id to a `doctor.ignore` array in `.unbranded.json`:

```json
{
	"doctor": {
		"ignore": ["missing-editorconfig", "no-ci-workflow"]
	}
}
```

Every finding id is stable and printed next to the finding, so you can copy it straight from a report. Suppressed findings drop out of both the human and `--json` output (a one-line count keeps them from vanishing silently) and no longer count toward the `--strict` exit code. A typo'd id gets a warning, not an error. `unbranded` preserves the block when it rewrites the state file, so re-running the scaffold won't wipe your accepted findings.

Diff and doctor are read-only and need no TTY, so they sit in CI as comfortably as at your prompt. In fact the whole non-interactive surface is a versioned contract for tooling and agents: every `--json` envelope has a shipped JSON Schema under `schemas/`, [AGENTS.md](AGENTS.md) documents the promise, and [docs/agent-cookbook.md](docs/agent-cookbook.md) walks the loop end to end.

Every apply records its work in two places: `.unbranded.json` (which files landed, their hashes, which unit wrote each one, and the options the run resolved) and an `.unbranded/` sidecar holding byte-exact baselines of the copied files. The baselines are the merge base `unbranded update` uses to fold newer templates into your repo without losing local edits, so commit the sidecar along with the state file. The envelope carries a `schema` field (now 2) so tooling can key off it; a schema-1 file from an older release still reads, it just predates baselines.

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

The common flags, with `unbranded --help` for the rest:

| Flag                          | Does                                                                 |
| ----------------------------- | -------------------------------------------------------------------- |
| `--config, -c <file>`         | run a JSON recipe non-interactively                                  |
| `--target <dir>`              | scaffold against `<dir>` instead of the current directory            |
| `--units <a,b,c>`             | pick units inline, no recipe file                                    |
| `--pm <npm\|pnpm\|yarn\|bun>` | set the package manager and skip detection                           |
| `--yes`                       | apply without the confirm prompt (needs `--units`/`--config`)        |
| `--latest`                    | take the newest versions, not the pins                               |
| `--dry-run`                   | resolve and report, write nothing                                    |
| `--force`                     | skip the dirty-tree guard                                            |
| `--json`                      | machine-readable output for `list`, `diff`, and `doctor`             |
| `--fix`                       | with `doctor`, install the units that close fixable findings         |
| `--cascade`                   | with `remove`, also remove the units that depend on the target       |
| `--strategy`                  | with `update`, answer every conflict: `ours`, `theirs`, or `markers` |
| `--registry <url>`            | with `outdated`, check a mirror instead of registry.npmjs.org        |

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

| Field         | Description                                                     |
| ------------- | --------------------------------------------------------------- |
| `units`       | array of unit ids; an unknown id fails validation immediately   |
| `pm`          | `"npm"`, `"pnpm"`, `"yarn"`, `"bun"`, or `null` to skip install |
| `onConflict`  | `"overwrite"` or `"skip"` for every file collision              |
| `postInstall` | `"all"` or `"none"` for every per-unit hook                     |
| `projectName` | required only in new-project mode                               |

Config mode skips the Apply confirmation. Don't want to hand-write the JSON? Finish an interactive run and it offers to save your choices as `recipe.json`, so you can explore once and replay everywhere. Inline flags like `--units` and `--pm` work without a recipe too, and override the matching recipe field when both are set.

### Exit Codes

- `0` — finished, including when you answer No at the Apply prompt
- `1` — an error: a bad recipe, an unresolvable selection, or failed detection
- `130` — cancelled with Ctrl-C at a prompt

## Preview a Run

`--dry-run` resolves the whole plan and prints what each file would do, then stops before writing a byte or touching the package manager. It works with or without `--config`.

```bash
unbranded --dry-run
unbranded --dry-run --diff   # add the unified patch for every file that would change
```

Every file gets one verdict: `would create`, `would merge`, `would append`, `identical`, or `conflict`. The closing summary mirrors a real run's `Files:` line, reworded as `Would:`.

## How It Works

1. **Target detection.** A `package.json` in the current directory means augment mode; otherwise the CLI asks for a name and works in the new directory it creates.
2. **Package manager detection.** It walks up for a lockfile, then falls back to the `packageManager` field, then `npm_config_user_agent`, then a prompt. With no `package.json` at all, files are written and install is skipped, and a next-steps block tells you what to run.
3. **Selection and resolution.** A category-grouped multiselect feeds a resolver that closes the set under `implies`, validates `requires`, and fails fast on an `excludes` violation.
4. **Guardrails.** In an existing git repo with a dirty working tree, unbranded warns before it writes anything, since a clean tree is your undo button (`git checkout .`). `--force` skips the check.
5. **Apply.** Existing files prompt for overwrite or skip with a colored diff. Structured units fold into `package.json`, `settings.json`, and ignore files rather than overwriting, and the run records what landed in `.unbranded.json`.
6. **Install and hooks.** The detected package manager runs under a Ctrl-C trap, then per-unit post-install steps (like `husky init`, gated on a real `.git/`) prompt with sensible defaults.

## Requirements

Node 22 or newer.

## Philosophy

- **`@antfu/eslint-config` over `eslint-config-next`** alone. @antfu gives uniform style, a11y, and formatting across every kind of project, not just Next ones.
- **Tabs over spaces**, because @antfu does tabs and I'm not picking that fight.
- **@antfu formats the code; Prettier is scoped to markdown only.** `@antfu/eslint-config` bundles `eslint-plugin-format` (dprint) for JS/TS/JSON/YAML/CSS/HTML. Prettier and dprint disagree on small persistent things like quote and key handling, and running both on code just makes them fight. `pnpm lint` is the only thing CI runs for code. Format-on-save is wired to ESLint for code and Prettier for markdown (via per-language formatters in `.vscode/settings.json`), because Prettier's prose-wrap and list reflow read better to me than dprint's. Markdown isn't in CI; it's an editor-only formatter for now. `.editorconfig` covers the basics for editors without an ESLint integration.
- **Stylelint exists** even on tiny projects. The same config works everywhere.
- **Strict TypeScript is non-negotiable.** `noUncheckedIndexedAccess` catches the bugs the basic `strict` flag misses.
- **`.vscode/` is committed**, and there's a unit for it. If you work in VS Code, a clone should just work.
- **Mobile-first when testing.** The opt-in Playwright config defaults to Pixel and iPhone profiles.

## Manual Clone

The CLI is the recommended path, but the repo itself works as a template if you'd rather hand-pick files:

```bash
# Copy locally
cp -r ~/repos/unbranded-starter ~/repos/new-project
cd ~/repos/new-project && rm -rf .git && git init

# Or degit (after pushing to GitHub)
pnpm dlx degit kendrick/unbranded-starter new-project
```

Then take what you want from the root configs and the `opt-in/` directories.

## License

MIT
