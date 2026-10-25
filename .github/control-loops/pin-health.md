# Pin-Health Control Loop Design

Status: agreed in Phase B of the `design-control-loop` skill and approved by the maintainer. The loop is built. Where building it changed the plan, [Changes While Building](#changes-while-building) says what changed and why, and the scripts are the source of truth from here.

`pin-bumps.yml` already keeps the manifest pins moving. Every Monday it grades them with `unbranded outdated --json` and opens one `bump/<unit>` PR per unit. It doesn't react when a bump PR goes red. This loop does. A second weekly job finds a red bump PR, has a coding agent either repair what broke or write down why the pin should be held, and opens one PR with the result.

## Set Point and Scope

Set point: every manifest pin is either current within its line or held with a recorded reason, and no bump PR stays red.

That's broader than "repair the unit so the bump lands", because history says repair alone covers too little. TS 7 (#131, #151) couldn't be fixed inside this repo, and the answer was a hold (#165, then #178). The typescript-eslint 8.71.1 break (#174) wasn't caused by a bump at all. Drift reached the preset e2e's lockfile-free install and turned every open PR red, and the fix landed in a shipped config file. So the agent gets three outcomes: repair, recommend a hold, or escalate.

The actuator may change these paths:

- `src/manifest/**`
- `templates/**`, `opt-in/**`, `presets/**`
- the shipped `postcss.config.mjs` and `stylelint.config.mjs`
- unit specs (`src/**/*.spec.ts`, `test/e2e/*.spec.ts`), to add or tighten assertions
- `package.json` and `pnpm-lock.yaml`, only through `pnpm install --lockfile-only`
- `.github/agent-memory/pin-health.md`

Everything else is read-only to it, including `.github/**` (apart from the memory file), `scripts/**`, `src/commands/**`, `src/cli.ts`, `schemas/**`, the docs, and `CHANGELOG.md`. The agent never skips, deletes, or env-gates an e2e spec, and never loosens CI. The skill states this list, and a deterministic scope guard in the workflow enforces it after the agent finishes.

## Sensor

The sensor has two inputs, and both exist today:

- `unbranded outdated --json` (schema 2) measures the gap: which pins trail the registry, by how much, and which units declare them.
- Check-run conclusions on open `bump/*` PRs and on main's latest completed CI run show which bumps are red and whether main is red on the same job.

`unbranded doctor --json` and `unbranded diff --json` stay out of the sensor. Both read `.unbranded.json`, and this repo's root has none, so they measure nothing here. They come back as validation inside a scaffolded temp project.

## Controller

`scripts/pin-health-controller.mjs` is deterministic, with a sibling `.spec.mjs` like `bump-pins.mjs`. Each run it does the following:

1. List open PRs on `bump/*` heads whose latest CI run failed.
2. Drop any PR whose unit already has an open `agent-pin-health` PR.
3. Drop any PR whose pin the memory file records as held.
4. Re-run the failed jobs once and wait for them, so a flaky Windows install doesn't cost an agent run. A PR that goes green drops out.
5. Pick the oldest remaining PR.
6. Check main. If main's latest completed CI run fails the same job, the target becomes `main-drift` instead of the bump, because the bump didn't cause the failure (#174).

It writes one JSON object for the actuator. The object has a `target` (`bump-pr`, `main-drift`, or `none`), the PR number, unit, and head branch, the failing jobs with their run and job ids, and a one-line reason. It handles one target per run.

Locally, `--no-rerun` skips step 4, because that's a GitHub write. The re-run policy, the oldest-first ordering, and the batch size of one are the settings to tune once real output comes in.

## Actuator

### Agent Seam

`scripts/pin-health-actuator.mjs` is the only place that knows which agent runs. It takes `--agent claude|codex` (default `claude`, overridable through `PIN_HEALTH_AGENT`), a prompt file, and an output path. It holds one agent-neutral policy, made of the allowed commands, the turn cap, and the budget cap, and turns it into each agent's flags. It also extracts the agent's final message into `/tmp/pr-body.md`. The workflow, controller, skill, and scope guard never mention an agent, so swapping agents is a flag change.

Claude Code is the agent for now:

```bash
claude -p "$PROMPT" \
  --allowedTools "Read" "Edit" "Write" "Glob" "Grep" \
    "Bash(pnpm build)" "Bash(pnpm typecheck)" "Bash(pnpm lint)" "Bash(pnpm lint:fix)" \
    "Bash(pnpm test)" "Bash(pnpm vitest run *)" \
    "Bash(pnpm install --frozen-lockfile)" "Bash(pnpm install --lockfile-only)" \
    "Bash(node dist/cli.js *)" \
    "Bash(git status)" "Bash(git diff *)" "Bash(git log *)" "Bash(gh run view *)" \
  --max-turns 60 \
  --max-budget-usd 10 \
  --output-format stream-json --verbose
```

The allowlist replaces `--permission-mode bypassPermissions`, so a headless run denies every tool not on it. The list has no git commit or push and no gh write. The workflow does all of those after the scope guard passes. The caps are starting guesses, and Phase D confirms each flag against the installed CLI version.

The Codex mapping is weaker, because Codex has no per-command allowlist:

| Policy           | Claude Code                                   | Codex (`codex exec`)                                                                                                                                                                                                                                                                                                                                 |
| ---------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Allowed commands | `--allowedTools` allowlist                    | No per-command allowlist. `--sandbox workspace-write` limits writes to the checkout and temp dirs, with `-c sandbox_workspace_write.network_access=true` so pnpm can install. An execpolicy rules file marks `git commit`, `git push`, `gh`, and `curl` as `forbidden`. It must not use `allow` rules, because an allowed command skips the sandbox. |
| File edits       | `Edit`/`Write` on the list                    | Anything inside the sandbox's writable roots                                                                                                                                                                                                                                                                                                         |
| Approvals        | Denied when not on the list                   | `--ask-for-approval never`                                                                                                                                                                                                                                                                                                                           |
| Turn cap         | `--max-turns 60`                              | No flag. The step's `timeout-minutes` stands in.                                                                                                                                                                                                                                                                                                     |
| Budget cap       | `--max-budget-usd 10`                         | No flag. The step's `timeout-minutes` and the model choice stand in.                                                                                                                                                                                                                                                                                 |
| Final message    | Last assistant text in the stream-json output | `--output-last-message /tmp/pr-body.md`                                                                                                                                                                                                                                                                                                              |
| Secret           | `ANTHROPIC_API_KEY`                           | `OPENAI_API_KEY`                                                                                                                                                                                                                                                                                                                                     |

Under either agent, the runner environment enforces the hard limits:

- The actuator step gets no GitHub token.
- Checkout runs with `persist-credentials: false`.
- The scope guard rejects any diff outside the scope list.
- The workflow re-runs validation itself before it commits.

### Credentials

`ANTHROPIC_API_KEY` doesn't exist yet. You need to add it as a repository secret before the workflow can run. Until then, the workflow's first step checks for the selected agent's secret. If the secret is missing, it stops with an error naming it, before any install or agent spend:

```bash
if [ -z "$ANTHROPIC_API_KEY" ]; then
  echo "::error::ANTHROPIC_API_KEY is not set. Add it as a repository secret before running agent-pin-health."
  exit 1
fi
```

The workflow reuses `PIN_BUMP_TOKEN` for the push and the PR, so the loop's PRs trigger CI the same way bump PRs do. The actuator step never sees it.

### Skill

`.claude/skills/repair-pin-bump/SKILL.md` holds the agent's judgement, with `references/response-template.md` for the PR body. It follows two patterns from this repo's history:

- #174's repair: fix the shipped file so it stays clean whatever upstream does, and add a spec assertion that fails before the fix.
- #165 and #178's hold: when the break can't be fixed inside this repo, recommend holding the pin at its current major and say why. The agent records the hold in the memory file and the PR body only. It doesn't touch `LINE_OPTIONS` or the bump tooling, and you decide whether to close the bump PR.

When the agent can't reproduce a failure, such as a Windows-only leg on an Ubuntu runner, it escalates. It writes up what it found and changes no code.

### Validation

The agent must pass these before it finishes:

1. `pnpm typecheck`
2. `CI=true pnpm lint`
3. `pnpm test`
4. `pnpm build`
5. the failing e2e spec, run with its job's env from `ci.yml` (for example `UB_PRESET=next-app pnpm vitest run --config vitest.e2e.config.ts test/e2e/preset-install.spec.ts`)

The workflow then runs the same commands again itself, so a PR never rests on the agent's word that they passed. CI covers the Windows legs.

## Disturbances and Dampener

These change the system from outside the loop:

- Upstream drift in lockfile-free scaffold installs (#174)
- Teammates moving manifest pins, which makes `bump-pins.mjs` exit 1 on a missed pin
- Sibling bump PRs conflicting on `pnpm-lock.yaml` (5 of the last 13 needed a manual merge of main)
- Flaky Windows installs
- Registry outages, which make `outdated` exit 1
- The release-please PR and Dependabot's Actions bumps

The dampener is an advisory e2e canary. A `schedule:` trigger on `ci.yml` (Sundays, 22:00 UTC) runs the full suite against main, so drift shows up before Monday's bump PRs go red. The controller reads that run in step 6. It never blocks a PR.

The lockfile conflicts stay out of this loop, because they're deterministic and a later change to `bump-pins.mjs` can handle them.

## Human on the Loop and Flow Control

- `.github/agent-memory/pin-health.md` holds standing feedback: held pins with their reasons, known-incompatible majors, and areas the agent should leave alone. The workflow loads it into the prompt after the controller runs.
- Every loop PR carries the `agent-pin-health` label and a hidden `<!-- agent-pin-health -->` marker. Its branch is `pin-health/<unit>` (or `pin-health/main-drift`), and its title starts with `fix(manifest):`.
- At most one `agent-pin-health` PR is open at a time. A scheduled run makes no changes when one already is, and `workflow_dispatch` bypasses the check.
- `bump-pins.mjs` skips any unit with an open `pin-health/<unit>` PR, so its weekly force-push can't overwrite the agent's branch.
- Phase F decides whether loop PRs support `/iterate`.

## Cadence

`agent-pin-health.yml` runs Tuesdays at 06:00 UTC (`0 6 * * 2`), a day after the bumps, plus `workflow_dispatch`.

## What Gets Built After Approval

- `scripts/pin-health-controller.mjs` and its spec
- `scripts/pin-health-actuator.mjs` (the agent seam) and its spec
- `scripts/pin-health-scope-guard.mjs` and its spec
- `.claude/skills/repair-pin-bump/SKILL.md` and `references/response-template.md`
- `.github/agent-memory/pin-health.md`
- `.github/workflows/agent-pin-health.yml`
- `scripts/bump-pins.mjs` and its spec: skip a unit with an open pin-health PR
- `.github/workflows/ci.yml`: the Sunday canary trigger

## Prerequisites

- Add the `ANTHROPIC_API_KEY` repository secret. The workflow can't run without it, and its first step fails on purpose until it exists.
- Confirm `PIN_BUMP_TOKEN` is set. CI ran on every recent bump PR, which suggests it is.
- Phase H's dry run needs a push of this branch, and you do that push.

## Changes While Building

- Claude Code 2.1.294 has no `--max-turns` flag. The actuator step's 60-minute `timeout-minutes` is the turn cap for both agents, and `--max-budget-usd 10` stays as Claude's spend cap.
- The Claude flags live in `claudeArgs` in `scripts/pin-health-actuator.mjs`, so the command above is out of date. They are `--setting-sources local`, `--strict-mcp-config`, `--tools Read,Edit,Write,Bash`, `--permission-mode dontAsk`, and `--permission-prompts none`, plus the allowlist. 2.1.294 has no Glob or Grep tool, so the allowlist adds `grep` and `ls`, and it leaves out `find` and `rg` because each can run arbitrary commands. `--bare` would skip `CLAUDE.md`, but it also drops Write, so the CI prompt tells the agent instead that the agent-guild and working-memory instructions don't apply.
- `gh run view` came off the allowlist because the actuator has no GitHub token. The controller downloads each failing job's log (the last 500 lines, with ANSI codes stripped) and passes the paths in the target.
- Validation runs through `scripts/pin-health-validate.mjs`. The agent can't set env vars, so it writes `/tmp/pin-health/repro.json` naming one `test/e2e/*.spec.ts` file and its `UB_*` env. The script checks that file's shape before it runs anything. The workflow skips validation for a hold or an escalation, since neither changes code.
- `codex exec` 0.160.0 has no `--ask-for-approval` flag, so approvals are set with `-c approval_policy="never"`. The forbidden-prefix rules go in a throwaway `CODEX_HOME`, which doesn't depend on project trust. `codex execpolicy check` confirms they block `git commit`, `git push`, `gh`, `curl`, and `npm publish` and leave `pnpm test` and `git status` alone.
- An escalation posts its report as a comment on the bump PR, with a hidden marker naming the head SHA. The controller skips that SHA from then on, so it never pays twice for the same commit. bump-pins rebuilds the branch every Monday, and a new head that's still red gets a fresh look.
- The controller skips a failed CI run that has no failing job. #151's run has that shape, because it failed before any job started. `--pr` and `--sha` replay the controller against a past PR head. Run against #171 at `0da64bd`, it picks `e2e preset next-app` and downloads the log that holds the #174 error.
- `--setting-sources local` loads only the gitignored `.claude/settings.local.json`. Neither a CI checkout nor a fresh worktree has one, so no settings file can add allow rules to the allowlist. User settings would bring in a maintainer's own allow rules on a local run.
- `--local` lets you replay a target by hand on your own Claude login, with the same allowlist and $10 cap. It refuses to run when `CI` or `GITHUB_ACTIONS` is set, so a workflow that's missing the secret still fails. It supports Claude only.
- `/iterate` on loop PRs is out of v1. To steer the loop, edit `.github/agent-memory/pin-health.md`. Revisit `/iterate` after the loop has opened a few PRs.
- The allowlist gains `pnpm view *` and `npm view *`, both read-only registry lookups. On the #171 replay the agent suspected drift but couldn't confirm it without checking what typescript-eslint resolves to today, so it escalated. The Codex rules forbid nothing new, so both commands run there too.
- The loop's own files run from a trusted copy (PR #235 review). Before the target branch is checked out, the workflow copies the `pin-health-*` scripts, the skill, the prompt, and the memory file from its own checkout into `$RUNNER_TEMP/pin-health-tooling`, and every loop step runs from there. Otherwise the branch under judgment would supply its own scope guard and validator, and an older bump branch would have no scripts at all. The prompt's Tooling block gives the agent each file's path, and Claude's validator rule and `--add-dir` point at the copy.
- A hold is published from `origin/main` (PR #235 review). `scripts/pin-health-classify.mjs` names the outcome from the agent's uncommitted changes against the target branch's head, before anything commits: no change is an escalation, only the memory file is a hold, and anything else is a repair. Only a repair runs the validator. `scripts/pin-health-publish.sh` then commits a repair on top of the bump, so the two land together, but moves a hold's memory change alone onto `origin/main`. On the bump branch, the hold PR would have carried the very bump it rejects into main, unvalidated.
- A main-drift escalation is recorded too (PR #235 review). It goes on the bump PR the controller picked it through (`.pr` in the target), with that PR's head SHA in the marker, so `hasEscalation` skips the PR until bump-pins pushes a new head. Before this, only bump-pr escalations left a marker, so the next run paid again for the same main-drift.
