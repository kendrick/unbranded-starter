# Decision Log

Append-only; newest entry on top. Don't edit past entries; supersede them with a new one.

Each entry follows this shape:

```markdown
## 2026-04-19: Short title

**Source:** the commit, PR, or discussion it came from (optional for hand-written entries)

**Context:** Why this came up.
**Decision:** What was decided.
**Alternatives considered:** What was rejected, and why.
```

## 2026-07-05: Milestone-4 "Trust + Ergonomics" underway — F-00 state-file completeness, F-01 doctor.ignore (issues #25-#26)

**Source:** issue #25 (F-00, merged as PR #45, commit acbac90) and issue #26 (F-01, commit 99ccce6 on main, unpushed); the first two of milestone #4, heading toward a 0.5.0

**Context:** Both are prerequisites for the day-2 verbs (doctor --fix / update), which can only act on what the state file records. #25 fixed a shipped-0.4 bug where two computed writes never reached the state map; #26 gives doctor's opinions a durable off switch so `--strict` can gate a real team's CI without arguing over which findings count.
**Decision:**

- **F-00.** `.nvmrc` (core-node-version) and `.vscode/extensions.json` (opt-vscode) are computed inside `writeAndInstall`, which runs after `writeStateFile`, so neither was ever hashed into `.unbranded.json` and `diff` silently ignored their drift. `writeAndInstall` now returns `computedWrites`; the state write moved to after install and threads them in through a new `extraWrites` param. `.nvmrc` is tracked only when we actually wrote it (existing user pins still win the merge). No STATE_SCHEMA bump — the shape is unchanged, the map is just complete.
- **F-01.** `unbranded doctor` reads a `doctor.ignore` array of finding ids from `.unbranded.json`. Suppressed findings leave both the human and --json report (a one-line count keeps them visible) and no longer count toward the --strict exit. An unrecognized id warns instead of erroring, told apart from a valid-but-quiet id by a `KNOWN_FINDING_IDS` registry that a spec test cross-checks against a live audit. DOCTOR_SCHEMA → 2 for the new `suppressed` / `ignoredUnknown` json fields.
- **The config rides in the tool-managed state file, so writeStateFile preserves it.** doctor.ignore is hand-edited into `.unbranded.json`, which every run rewrites from scratch. writeStateFile now reads the prior file and carries the `doctor` block forward; without that the "durable off switch" would evaporate on the next scaffold. This went slightly beyond the issue's acceptance criteria and was flagged for review.

**Alternatives considered:** A separate doctor config dotfile (e.g. `.unbrandedrc`) — rejected; the issue scopes the config to `.unbranded.json`, and one tool-owned file beats two. Bumping STATE_SCHEMA for the additive `doctor` block — rejected; optional additive fields stay forward-tolerable, which is exactly what the schema-bump comment reserves a bump for. Tracking package.json among the computed writes — rejected; it's a merge target the user keeps editing, so diffing it against a scaffold-time hash would be permanent noise.
**Process note:** #25 shipped as a branch + PR (#45); from #26 on, the maintainer asked for local commits straight to `main` (no auto-push, no PR), reconciling with merged PRs at push time. #26 was rebased onto origin/main after #45 landed; the overlapping `writeStateFile` edits auto-merged cleanly.

## 2026-07-04: Seeding the roadmap into the GitHub tracker (milestones #4-#8, issues #25-#44)

**Source:** a GitHub-side session that turned `tmp/roadmap.md` (gitignored) into milestones, issues, and labels on the `kendrick/unbranded-starter` repo; no code, no commits

**Context:** The roadmap listed 20 features (F-00–F-19) grouped into five themed sections, each feature carrying an impact/effort quadrant, acceptance criteria, and "split into N issues" decomposition notes. Turning it into a live tracker meant settling several conventions the roadmap doc left open, so the maintainer chose them via a clarifying question — logged here because they govern any future issue-seeding.
**Decision:**

- Milestones are theme-named, not version-numbered — #4 "Trust & ergonomics — the runway to 1.0" (F-00–F-07), #5 "1.0 — Close the loop" (F-08–F-11 plus F-18, pulled up from the backlog), #6 "After 1.0 — Reach & polish" (F-12–F-13), #7 "2.0 — Unwelding" (F-14–F-16), #8 "Backlog — Community & agents" (F-17, F-19).
- One issue per feature, 20 total (#25–#44 for F-00–F-19), created in roadmap-priority order so issue numbers ascend with priority. Each body opens with a `**Roadmap:** F-NN` line, then rationale, then the verbatim acceptance-criteria checklist, then any decomposition notes — kept in-body to split later when the work is scheduled, rather than exploding ~30 speculative sub-issues up front.
- Issue titles are plain descriptive, not `feat(scope):`, to match the 23 existing (closed) issues — even though the roadmap doc's own conventions section suggested `feat(scope):`. Issue titles don't feed release-please; only commit messages do.
- Type labels: `bug` on the one correctness fix (F-00 / #25); `documentation` on the two doc-first features (F-18 / #37 agent contract, F-14 / #40 unit schema); `enhancement` on the rest.
- New `q1`–`q4` quadrant labels (color-graded green→red) carry the roadmap's impact/effort quadrants. It's a fresh taxonomy — the 23 pre-existing closed issues predate it and weren't backfilled.

**Alternatives considered:** `feat(scope):` issue titles per the roadmap doc — rejected for consistency with the existing tracker. Exploding every decomposition note into sub-issues now — rejected as premature for speculative 2.0/backlog work; the notes ride in-body and split when scheduled. Version-numbered milestones — rejected; the maintainer groups by theme, not explicit versions.

## 2026-07-04: v0.4 "keep it in the repo" shipped as 0.4.0 (issues #18-#23)

**Source:** the v0.4 batch, built in three parallel worktrees (manifest/command/flow) via TDD then reconciled onto main by cherry-pick; released by release-please (tag v0.4.0, PR #24); issues #18-#23

**Context:** v0.4 added the state file + `unbranded diff` (#18), a git dirty-tree guard with `--force` (#19), `unbranded doctor` (#20), the `core-node-version` unit + `packageManager` merge (#21), the mundane-pain units core-gitattributes/opt-vscode/opt-ci-github (#22), and save-as-recipe (#23). Two of those units can't ship as static templates, which drove the load-bearing design call.
**Decision:** Node pins (`.nvmrc` + `engines.node` + `packageManager`) and `.vscode/extensions.json` are COMPUTED at write time — the node pins in `install/run.ts` from the running node major plus the detected pm's real version (all from one source, existing user values always win), and extensions.json in `install/vscode-extensions.ts` from each unit's `recommendedExtensions`. Shipped as 0.4.0 with the README rewritten for the feature set and `.unbranded.json` made self-describing for agents (the `_tool` breadcrumb plus the AGENTS.md machine-readable-surface pointer).
**Known wart (now filed):** both computed writes land in `writeAndInstall` AFTER `writeStateFile`, so they're absent from `.unbranded.json` and `diff`/`doctor` miss their drift. Accepted at ship time; now tracked as issue #25 (F-00), first in the Trust milestone and a prerequisite for the day-2 verbs.
**Alternatives considered:** Shipping the pins as static template files — rejected; a static `.nvmrc`/`packageManager` would lie about the running toolchain and stomp existing user values. Making opt-ci-github's workflow pm-aware — deferred (copy layer is static-only; would need another computed write). opt-agents and opt-renovate — deferred (no clean generic source yet).

## 2026-07-02: v0.3 real-repo ergonomics (issues #11-#17)

**Source:** the v0.3 batch, built in three parallel worktrees then reconciled onto main; issues #11-#17

**Context:** v0.3 ("try it on a real repo") covers current-dir support, git init, dry-run, the declared-but-dead FileOp modes, a unit catalog, inline flags, and target/pm overrides. Several choices weren't obvious from the issues.
**Decision:**

- `.` scaffolds into cwd unconditionally (no safe-set gate) since typing `.` is explicit intent; a _named_ existing dir instead gets the safe-set confirm (empty or only `.git`/`README.md`/`LICENSE`/`.gitignore`), else the never-clobber refusal holds. In-place runs stay `mode: 'new'`.
- git init runs before post-installs so husky's `requires: 'git'` gate passes the same run; the recipe `git` field defaults to `'none'` (interactive prompts, default init). A missing git binary warns and continues.
- `copyFileOp` now dispatches on `op.mode`: `merge-json` deep-merges and routes same-key collisions through the existing diff/prompt UX (`onConflict` resolves them in config mode), `append-if-missing` is idempotent. No unit ships these modes yet, so committed e2e fixtures under `test/fixtures/fileop-modes/` keep them live. `CopyAction` gained `merged`/`appended`.
- `--dry-run` sits ahead of the Apply gate so it previews identically in interactive and `--config` mode, writing nothing; `--diff` adds the unified patch.
- Inline flags build a `Config` through `resolveConfig` and win per-field over `--config` (mirrors `--latest` vs `versions`); `--yes` needs `--units` (or `--config`). `resolveConfig` must pass `git` through — the reconciliation caught it dropping the field.
- `--target` threads a `cwd` into `detectTarget` rather than `process.chdir`, since every write/install already keys off `target.dir`; a relative `--config` therefore still resolves against the invocation cwd. `--pm` rides `detectPm`'s existing `override`, which short-circuits before the workspace-leaf refusal, so it doubles as the monorepo escape hatch.
- Added a root `.gitattributes` (`* text=auto eol=lf`) so the Windows CI lint leg stops failing on CRLF: the runner checks out CRLF, and @antfu's Prettier markdown formatter flags the mismatch (it first bit `decisionLog.md`'s embedded fence).
  **Alternatives considered:** For `--target`, a global `process.chdir` up front (rejected: it would break relative `--config` resolution and isn't needed since target.dir is explicit everywhere). For the FileOp modes, waiting for a real `.gitignore`/`opt-vscode` consumer before wiring dispatch (rejected in the issue itself: it would leave `mode` dead; fixtures prove the path now).

## 2026-07-02: `--latest` writes the `latest` dist-tag (not caret ranges)

**Source:** commit 1133581; issue #3

**Context:** The README and a manifest comment advertised `--latest` as the escape hatch from pinned versions, but the flag was never implemented (parseArgs threw). The open question was what "latest" should write into package.json.
**Decision:** Rewrite every dependency spec to the bare `latest` dist-tag. It's the most faithful reading of the flag (opt out of pinning, take bleeding edge), threads a single boolean from the CLI to `writeAndInstall`, and keeps single-run reproducibility via the lockfile. A `versions: "pinned" | "latest"` recipe field gives config mode parity; the flag wins when both are set.
**Alternatives considered:** Resolving to caret ranges via `pm add pkg@latest`, rejected as a bigger change (per-PM add semantics, no-PM path) that quietly re-pins after one run, which contradicts the opt-out intent.

## 2026-07-02: Lower the Node floor to 22 (supersedes the Node 24 decision)

**Source:** commit 88f1ae3; issue #5

**Context:** `engines` required Node 24, but an audit found nothing in the code needs it — the only modern API, `import.meta.dirname`, is stable since Node 20.11. Node 22 is the active LTS most machines run, so the 24 floor filtered out real users for no reason. The earlier "Bump minimum Node to 24" entry below rested on a backwards comment in `src/util/paths.ts`, now corrected.
**Decision:** `engines.node`, the tsup target, and `.nvmrc` all move to 22 (and `create-unbranded` with them). Since npm only warns on `engines`, `cli.ts` checks `process.versions.node` up front and exits 1 with one readable line when it's too old. CI runs a Node 22 + 24 matrix.
**Alternatives considered:** Keeping 24 and only adding the friendly guard — rejected; the floor itself was the problem, not just the error message. Dropping to Node 20 — rejected, 20 is EOL (2026-04).

## 2026-07-02: New-project PM detection is mode-aware and skips the ancestor walk-up

**Source:** commit 47d002f; issue #2

**Context:** New-project mode created an empty directory, then detected the package manager against it before `writeAndInstall` seeded `package.json`, so `inspectPm` returned `no-pkg`/null before the user-agent check ran. The flagship "start from nothing" flow skipped install, post-installs, and husky.
**Decision:** Detection takes the target mode. In new mode it reads `npm_config_user_agent` first, prompts otherwise, and never returns null. It skips the ancestor lockfile walk-up entirely so a stray parent lockfile can't pose as intent. Consequence: new mode no longer hits the workspace-leaf refusal (that refusal shares the walk-up loop), so scaffolding a brand-new isolated subdirectory inside a monorepo is now allowed. Augment mode is unchanged, workspace-leaf refusal included.
**Alternatives considered:** Keeping the walk-up but special-casing the null return — rejected; the walk-up is meaningless for a brand-new directory and its signals are noise.

## 2026-07-02: Release automation via release-please + npm trusted publishing

**Source:** commits 004de87, 9f6e966; issues #1, #6

**Context:** `unbranded` was published to npm by hand, with no tags, releases, changelog, or provenance. The commit history is already conventional, so the inputs for automated versioning existed but nothing consumed them.
**Decision:** release-please (manifest mode, single package) maintains a rolling Release PR from conventional commits; merging it tags, cuts a GitHub release, and triggers a publish job that ships to npm over OIDC trusted publishing with provenance. The `create-unbranded` launcher lives in-repo and is version-locked to `unbranded` via release-please `extra-files` stamping, published by the same job. Backfilled a `v0.1.0` tag on the npm-recorded publish commit (3c578b6) so the first changelog only covers real post-0.1.0 history.
**Alternatives considered:** semantic-release (publishes on every push, no human gate) — rejected for the PR-based gate. changesets (changeset-file driven, monorepo-shaped) — rejected for a single package with already-conventional commits. A long-lived `NPM_TOKEN` — rejected for tokenless OIDC. A pnpm workspace holding both packages — rejected because a root `pnpm-workspace.yaml` re-triggers `eslint-plugin-pnpm` (see the entry below) and the launcher's dependency must resolve from the registry, not a workspace link.

## 2026-07-01: Disable `pnpm/yaml-enforce-settings`

**Source:** commit 10777d7

**Context:** `eslint-plugin-pnpm` auto-enables when a `pnpm-workspace.yaml` is present. On every `--fix` it injects `trustPolicy: no-downgrade` into the workspace file, which makes pnpm reject the lockfile.
**Decision:** Turn the rule off in `eslint.config.mjs` so monorepos scaffolded from this starter stay clean.
**Alternatives considered:** Leaving it on and documenting a manual cleanup step — rejected as a footgun the CLI would inflict on every generated monorepo.

## 2026-07-01: Adopt a two-tier working memory kit

**Source:** commit b21b077

**Context:** No durable place for agents to read project shape, decisions, and negative knowledge across sessions.
**Decision:** Scaffold `_working-memory/` with an always-read `activeContext.md` (local, gitignored, ≤20 lines) plus on-demand slower-moving files. `AGENTS.md` holds the canonical on-demand table.
**Alternatives considered:** Stuffing everything into `CLAUDE.md`/`AGENTS.md` — rejected because it doesn't scale and offers no eviction discipline.

## 2026-05-12: Non-interactive `--config` mode, JSON only in v1

**Source:** commit aa823d3; `src/config/load.ts`

**Context:** CI and reproducible recipes need a way to run without prompts.
**Decision:** Add `--config <file>` taking a JSON recipe (`units`, `pm`, `onConflict`, `postInstall`, `projectName`); skip the Apply confirmation in this mode.
**Alternatives considered:** YAML support — deferred. Easy to add later (key off extension, pull in `yaml`) but not load-bearing for the E2E suite that motivated the mode.

## 2026-05-12: Bump minimum Node to 24

**Source:** commit ac18ab4

**Context:** `src/util/paths.ts` uses `import.meta.dirname` to anchor `PKG_ROOT`.
**Decision:** Set `engines.node` to `>=24` and target `node24` in tsup; `import.meta.dirname` is then guaranteed.
**Alternatives considered:** Polyfilling the dirname resolution for older Node — rejected as needless complexity for a greenfield tool.

## 2026-05-12: Bundle `@antfu` peer deps explicitly in the eslint unit

**Source:** commit fff58b4; `src/manifest/index.ts` (core-eslint)

**Context:** The shipped `eslint.config.mjs` opts into `react: true` / `nextjs: true`. Without those optional peers installed, ESLint fails to load, and CI has no TTY for antfu's auto-install prompt.
**Decision:** List the peers (`@eslint-react/eslint-plugin`, `@next/eslint-plugin-next`, `eslint-plugin-format`, `eslint-plugin-jsx-a11y`, `eslint-plugin-react-refresh`) explicitly in the `core-eslint` unit's `devDependencies`.
**Alternatives considered:** Relying on antfu's interactive auto-install — rejected (see antipatterns).

## 2026-05-12: Markdown formatting is Prettier-in-editor, not ESLint/CI

**Source:** commit 9ee2639; `README.md` Philosophy

**Context:** `@antfu/eslint-config` bundles dprint for non-code formatting, but dprint and Prettier disagree on prose wrap / list reflow, and loading the full antfu chain on every `.md` save hangs the editor.
**Decision:** `markdown` is omitted from `.vscode` `eslint.validate`; a per-language override delegates `.md` formatting to Prettier. Code formatting stays with ESLint, which is the only thing `pnpm lint` runs. Markdown is editor-only, not in CI.
**Alternatives considered:** Running both Prettier and dprint on code — rejected (see antipatterns).
