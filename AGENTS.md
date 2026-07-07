# AGENTS.md

Two kinds of agent land here. If you're **using** the unbranded CLI—scaffolding, auditing, or updating a project—the contract below is yours. If you're **working on** this repo, skip to [Build / Test / Lint](#build--test--lint) and the Working Memory section.

## The Non-Interactive Contract (v1)

Everything below is a versioned promise as of 1.0. Each JSON surface carries an integer `schema` field; key off that, never off field sniffing. A breaking change to a surface bumps its `schema` integer, and the package major moves with it. This package ships one JSON Schema per surface under `schemas/`—validate against the copy in your installed version.

No command below needs a TTY. Anything interactive has a flag that answers it.

### Commands

| Command                                                          | Writes?              | Exit                                                 |
| ---------------------------------------------------------------- | -------------------- | ---------------------------------------------------- |
| `unbranded list --json`                                          | no                   | 0                                                    |
| `unbranded diff --json`                                          | no                   | 0 clean, 1 on drift                                  |
| `unbranded doctor --json [--strict]`                             | no                   | 0; `--strict` exits 1 on active findings             |
| `unbranded outdated --json [--strict] [--registry <url>]`        | network reads only   | 0; `--strict` exits 1 when majors are behind         |
| `unbranded --dry-run --json --units <ids> --pm <pm>`             | no                   | 0                                                    |
| `unbranded --config <recipe>` or `--units <ids> --pm <pm> --yes` | yes (scaffold)       | 0, 1 on failure                                      |
| `unbranded update --yes --strategy <ours\|theirs\|markers>`      | yes                  | 0; 1 on a conflict with no strategy                  |
| `unbranded remove <unit> --yes [--cascade]`                      | yes                  | 0; 1 when dependents block or the unit isn't tracked |
| `unbranded doctor --fix --yes`                                   | yes (installs units) | 0, incl. nothing-to-fix; 1 on apply failure          |

### Exit Codes

`0` is success, which includes answering No at a confirm and clean reports that found things (doctor findings, stale pins). `1` is every error and every `--strict` gate. `130` is Ctrl-C at a prompt. The single source is `src/util/exit-codes.ts`; nothing exits with anything else.

### Recipes

`--config <file>` drives a full run from JSON—schema in `schemas/recipe.schema.json`. Required: `units`, `pm` (`null` skips the install), `onConflict`, `postInstall`. Optional: `options`, `versions`, `projectName` (new-project mode), `git`, `force`. Unknown extra keys are tolerated. Inline flags override the matching recipe field per field, and `--units` accepts an `id:value` suffix for unit options (`core-eslint:react`).

### JSON Envelopes

| Surface            | Schema file                    | `schema` today |
| ------------------ | ------------------------------ | -------------- |
| `list --json`      | `schemas/catalog.schema.json`  | 2              |
| `diff --json`      | `schemas/diff.schema.json`     | 1              |
| `doctor --json`    | `schemas/doctor.schema.json`   | 2              |
| `outdated --json`  | `schemas/outdated.schema.json` | 1              |
| `--dry-run --json` | `schemas/plan.schema.json`     | 1              |
| `.unbranded.json`  | `schemas/state.schema.json`    | 2              |

### The State File And Its Sidecar

A scaffolded repo carries `.unbranded.json` at its root: installed units, one content hash per tracked file, and (schema 2) which unit wrote each file, how it was produced, and the run's resolved options. Beside it, `.unbranded/baseline/` holds byte-exact copies of the copy-mode files as written—the merge base `update` uses. Both belong in version control. `diff`, `doctor`, `update`, and `remove` all read the state file; only the CLI should write it.

### The Loop

The whole day-2 cycle, non-interactively:

```bash
unbranded doctor --json                                   # what's missing, and which unit fixes it
unbranded --dry-run --json --units <ids> --pm <pm>        # what applying those units would do
unbranded --units <ids> --pm <pm> --yes                   # apply
unbranded diff --json                                     # verify: exit 0, no drift
```

A worked version with real transcripts lives in [docs/agent-cookbook.md](docs/agent-cookbook.md).

## Build / Test / Lint

For agents working on this repo:

- Install: `pnpm install`
- Build: `pnpm build`
- Unit tests: `pnpm test`
- E2E tests: `pnpm test:e2e` (builds first)
- Everything: `pnpm test:all`
- Typecheck: `pnpm typecheck`
- Lint: `pnpm lint` (CI parity: `CI=true pnpm lint`)

<!-- working-memory:start -->

## Working Memory

This project uses a two-tier working memory at `_working-memory/`.

**AGENT INSTRUCTION:** scan this section BEFORE deciding what to read. If your task matches a row in the on-demand table, that file is required reading before you proceed.

### Always read on session start:

- `_working-memory/activeContext.md`: current focus, last decision, known risks (≤20 lines, local only / gitignored)

### Read on demand:

| File                 | Read when...                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------- |
| `projectOverview.md` | Before starting a feature, or onboarding to the codebase                                          |
| `decisionLog.md`     | Before an architectural or scoping decision; check what's already been settled                    |
| `dataContracts.md`   | Before creating or changing anything that produces or consumes shared data                        |
| `conventions.md`     | Before writing new code, or when reviewing a pattern                                              |
| `openQuestions.md`   | When you hit ambiguity; check here before guessing                                                |
| `antipatterns.md`    | Before proposing a refactor, library swap, or architectural change; check whether it's been tried |

### Updating working memory:

- After completing a feature or making a significant decision, update `activeContext.md` and the relevant on-demand file.
- `activeContext.md` is a queue: evict completed items to `decisionLog.md`.
- `decisionLog.md` and `antipatterns.md` are both append-only. Never edit past entries.
- Never let `activeContext.md` exceed 20 lines.
<!-- working-memory:end -->

## Conventions

<!-- Populated from detection or manually. Keep to ≤10 rules. -->
