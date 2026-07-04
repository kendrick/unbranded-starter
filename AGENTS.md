# AGENTS.md

## Stack

- Language: JavaScript/TypeScript

## Build / Test / Lint

- Install: `pnpm install`
- Build: `pnpm build`
- Unit tests: `pnpm test`
- E2E tests: `pnpm test:e2e` (builds first)
- Everything: `pnpm test:all`
- Typecheck: `pnpm typecheck`
- Lint: `pnpm lint` (CI parity: `CI=true pnpm lint`)

## Machine-readable surface

The CLI describes itself. Prefer these over reading the manifest by hand:

- `unbranded list --json` — the full unit catalog: ids, categories, descriptions, and the paths each unit writes.
- `unbranded doctor --json` — audits the current repo and names the unit that fixes each gap.
- `unbranded diff --json` — drift of scaffolded files against the recorded `.unbranded.json`.

A scaffolded repo carries `.unbranded.json` at its root (units plus one content hash per file); `diff` and `doctor` read it, and its `_tool` field says as much.

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
