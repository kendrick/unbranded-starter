---
name: repair-pin-bump
description: Repair, hold, or escalate a red pin-bump PR or the main-branch drift behind it. Use when the pin-health loop hands you a controller target, or when a `bump/<unit>` PR fails CI.
---

# Repair Pin Bump

You work one target the pin-health controller picked: a `bump/<unit>` PR whose CI stays red after a re-run, or a CI job that also fails on main (`main-drift`). The set point is that every manifest pin is current within its line or held with a recorded reason, and that no bump PR stays red.

Every run ends in exactly one **outcome**:

- **repair**: a change inside the scope that turns the failing job green while keeping the bump.
- **hold**: the break can't be fixed inside this repo, so you record a hold in the memory file and change no code.
- **escalate**: you couldn't reproduce or diagnose the failure, so you write up what you found and change nothing.

## Ground Rules

- The scope is `SCOPE` in `scripts/pin-health-scope-guard.mjs`. Read it before you edit. The workflow rejects your whole change if one path falls outside it.
- Keep every spec running. A failing e2e is the evidence; delete nothing, and add no skip or env gate. The scope guard rejects those too.
- Keep the bump's pin values as the bump PR set them. Moving a pin back is a hold, and holds go in memory.
- The workflow commits, pushes, and opens the PR after you finish. Leave your changes uncommitted.
- Work unattended. Nobody can answer a question mid-run, so when you'd ask, escalate instead.

## Workflow

### 1. Read the target

The prompt's **Selected Work** block is the controller's JSON: `target`, `pr`, `unit`, `bumps`, and `run.failedJobs`, where each job has a `name` and a `log` path. Read every log file it names, then read the matching job in `.github/workflows/ci.yml` to find the spec file and the `UB_*` env that job sets.

Completion criterion: for each failing job, you can name the spec file, its env, and the first error line from the log.

### 2. Reproduce

Write `/tmp/pin-health/repro.json` as `{ "spec": "test/e2e/<file>.spec.ts", "env": { "UB_…": "…" } }`, taken from that job. Then run `node scripts/pin-health-validate.mjs repro`, which rebuilds and runs that one spec the way CI does.

Completion criterion: the spec fails locally with the error the CI log shows. If it passes, or the job only runs on Windows, go to **escalate** with what you saw.

### 3. Diagnose

Classify the cause, citing the log line and the code that prove it:

- **bump-caused**: a bumped package (see `bumps`) changed behavior that a shipped file or generated config depends on.
- **drift**: an unpinned or transitive dependency moved under a lockfile-free scaffold install. This is always the cause when `target` is `main-drift`.
- **upstream-incompatible**: the bumped version can't work with this repo's toolchain at all, such as a peer range that excludes it or a removed API another pinned tool loads.

Completion criterion: one cause, with the log line and file that show it.

### 4. Act on the outcome

For **bump-caused** and **drift**, make the repair. Follow the shapes in `.claude/skills/repair-pin-bump/references/golden-patterns.md`: fix the shipped file or the generator so the scaffold is correct whatever upstream does, and add a spec assertion that fails without your fix. Touch only the files the diagnosis named.

For **upstream-incompatible**, record the hold. Add a bullet under `## Held pins` in `.github/agent-memory/pin-health.md` in exactly this form, which the controller parses:

```markdown
- `<package>` held at <current major> (<unit>): <one-line reason, with the PR number>
```

Then change no code.

Completion criterion: the diff holds only the repair and its assertion, or only the memory bullet, or nothing for an escalation.

### 5. Validate

For a repair, run `node scripts/pin-health-validate.mjs all`. That runs `pnpm typecheck`, `CI=true pnpm lint`, `pnpm test`, and `pnpm build`, then your reproduction. Fix anything it reports, and run it again until it passes. For a hold or an escalation, skip this step.

Completion criterion: the last run prints PASS on every line, or your report names the exact command that still fails and why you stopped.

### 6. Write the report

Read `.claude/skills/repair-pin-bump/references/response-template.md` and write your final message in that format. The workflow uses it as the PR body, or as a comment on the bump PR when you changed nothing.

Completion criterion: the message follows the template, names the outcome, and quotes the log line the diagnosis rests on.

## Review Checklist

- The reproduction failed locally before the change and passes after it.
- Every changed path is in `SCOPE`, and no spec was skipped, gated, or deleted.
- The bump's pin values are unchanged.
- A new or tightened assertion covers the repair.
- A hold appears only in the memory file, in the parseable form.
