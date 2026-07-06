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

## 2026-07-06: `unbranded update` — baselines advance even on keep-mine, plus the no-baseline ladder (issue #34, PR #63)

**Source:** PR #63 (commits 974b652, 0cef4ce, 180c558), closing #34; parts 1 and 2 of the arc are the schema-2 and merge3 entries below.

**Context:** `unbranded update` re-renders the installed units' templates (the recorded options baked in, so a react-flavor scaffold replays as react) and folds them into the scaffold: copy-mode files three-way merge against the sidecar baseline via `computeUpdate`, merge-json/append files reuse `planFileOp` so update's structured behavior stays in lockstep with the scaffold's, and package.json is re-derived through `mergePackageJson` (existing-wins, so user customizations hold). `planUpdate` follows auditRepo's filesystem-in/plan-out shape; `computed` files point back at a re-scaffold, and `template-gone`/`user-deleted` are report-only. Two calls weren't obvious.
**Decision:**

- **Baselines ADVANCE to the current template even on keep-mine.** `refreshTrackedFiles` (state.ts) is update's only state door: it refreshes hashes for what's on disk and moves baselines forward — nothing else. If keep-mine left the baseline behind, the next update would re-read the same drift and re-ask, or under `--strategy theirs` silently overturn a choice the user already made. Disk and baseline legitimately diverge.
- **No-baseline degradations (schema-1 scaffolds, deleted sidecar).** When the recorded hash still matches disk, the disk IS its own merge base and the merge stays exact. When the file was modified, it's `needs-choice` — ours or theirs only, because with no base there are no honest markers to render (`--strategy markers` warns and keeps ours for these).
- **Conflicts need an explicit answer.** Interactive runs ask per file; `--strategy <ours|theirs|markers>` answers globally for CI; `--yes` without a strategy exits 1 on conflict instead of guessing.
- **update never spawns installs.** A changed package.json is reported with a "run your PM's install to sync the lockfile" next step.

**Alternatives considered:** Freezing the baseline on keep-mine — rejected; it re-litigates the same drift on every run. Rendering markers for no-base files — rejected; markers without a base misattribute lines. Guessing a conflict answer under `--yes` — rejected; a CI run should fail loudly.

## 2026-07-06: node-diff3 becomes the fourth runtime dependency, behind one swappable wrapper (issue #34, PR #62)

**Source:** PR #62 (commit 79f6ebb); the maintainer approved the new dependency.

**Context:** update's copy-mode path needs a text three-way merge (base = sidecar baseline, mine = disk, theirs = the fresh template render). `diff` (jsdiff) is already a dep, but v9 exposes no three-way merge API.
**Decision:** `node-diff3@3.2.1`, pinned like every other dep. `src/fs/merge3.ts` is a pure wrapper that owns everything around the region math: a terminator-preserving line split (`split(/(?<=\n)/)`) so CRLF files and a missing trailing newline survive the round trip byte-exact, git-style markers labeled `yours`/`template` (git's orientation from the user's seat), `excludeFalseConflicts` so both sides making the identical change reads as agreement, and the `UpdateStatus` vocabulary `computeUpdate` derives from the three contents (`up-to-date | clean-update | merged | conflict`). Nothing else imports node-diff3, so the dependency stays swappable behind one small surface.
**Alternatives considered:** jsdiff for the merge — no merge API in v9. Writing the diff3 region math in-repo — rejected; it's a solved problem and the wrapper already isolates the risk.

## 2026-07-06: `unbranded remove` — hash-checked, ref-counted back-out that refuses to strand dependents (issue #36 / F-11, PR #60)

**Source:** PR #60 (commits 044384c, f309f64, 20ccbac, 91aea70, 50702d3).

**Context:** The exit door for the day-2 loop: doctor names what a unit should look like, remove backs one out. The danger axis is user data — edited files and rewritten scripts exist nowhere else — so every default leans conservative.
**Decision:**

- `planRemoval` follows the auditRepo pattern (filesystem in, plan out), so the whole decision surface tests without prompts.
- **Deletions are hash-checked.** Files still matching their recorded hash delete outright; modified files prompt per file (default no), and `--yes` KEEPS them — on disk but untracked. merge-json/append files always stay (they carry user content alongside the unit's) and merely stop being tracked.
- **package.json backs out by reference count.** New `removePackageJsonEntries` (merge-json.ts) drops deps by name only when no remaining unit claims them, and scripts only when the value still matches what the unit shipped — a rewritten script is the user's now, kept and reported. Contributions are computed with the RECORDED options baked in. engines/packageManager are never touched (CI and corepack read them); they're named as manual steps instead.
- **Dependents block removal.** New `dependentsOf` (resolve.ts) runs the resolver's implies/requires closure in reverse; remove refuses with the list, `--cascade` takes the whole set out.
- **`applyRemovalToState` is the only way the tracked set shrinks** (writeStateFile only grows). Removing the last unit deletes the envelope and sidecar entirely — a lingering README would advertise management that no longer exists.
- New `Unit.removeNotes` carries un-undoable side effects into next steps; opt-husky's `core.hooksPath` detach note is the first.

**Alternatives considered:** Deleting modified files under `--yes` — rejected; a non-interactive run should never destroy edits that exist nowhere else. Auto-cascading dependents without a flag — rejected; the refusal keeps the blast radius explicit. Unpinning engines/packageManager automatically — rejected; silently unpinning node is exactly the surprise remove exists to avoid.

## 2026-07-06: State schema 2 — sibling maps, baseline sidecar, and merge-not-replace (issue #34, PR #59; shipped as 0.7.0)

**Source:** PR #59 (commit 13fde33), released immediately as 0.7.0 (#58).

**Context:** update and remove need what schema 1 never recorded: which unit wrote each file, how it was produced, which options were live, and the original bytes to merge against.
**Decision:**

- `STATE_SCHEMA` 2 adds optional sibling maps next to `files` — `options` (the run's resolved unit options), `attribution` (rel → owning unit, recorded at write time because manifest dests drift across versions and a replay would misattribute), `modes` (rel → `copy | merge-json | append-if-missing | computed`). The `files` hash map stays byte-compatible with v1, so a schema-1 reader still parses what it knows; consumers key off `schema`, not field-sniffing.
- **Baseline sidecar.** `.unbranded/baseline/` keeps byte-exact copies of copy-mode files — update's merge base — plus a README telling a human what the directory is and why to commit it. Only copy-mode files get baselines; structured/append/computed files refresh structurally, and a wrong merge base is worse than none (strays are pruned).
- **`writeStateFile` now MERGES with the prior envelope** instead of last-run-wins: remove's ref-counting reasons over the whole scaffold history, so a run that adds one unit must not forget the earlier ones. Only remove shrinks the set.
- `computedWrites` carry their unit (`TrackedWrite { dest, unit, mode }`), so attribution covers the computed files too.
- **Released as 0.7.0 straight away** so real scaffolds start accumulating baselines before `update` ships.

**Alternatives considered:** (settled in the maintainer Q&A, see the milestone entry below) Embedding baselines in the envelope — rejected; it bloats a hand-readable JSON with file bodies. Re-fetching the old template from the registry at update time — rejected; it needs the network and the exact old package version. Breaking the `files` shape — rejected for v1 byte-compat.

## 2026-07-06: doctor --fix repairs through the existing apply pipeline, not a second one (issue #33 / F-08, PR #57)

**Source:** PR #57 (commit 7262b2b), the first milestone-5 PR.

**Context:** doctor already names the unit that closes each finding; F-08 closes the audit→repair loop without inventing a parallel installer.
**Decision:** `runDoctorFix` collects the unit-fixable findings POST-suppression (so `doctor.ignore` holds) and hands their units to `runInit` — resolver, plan, guardrails, and prompts all still apply. Interactive runs open the unit picker preselected but editable via a new `initialSelected` seam in `createPickerState` (unknown ids are dropped so a caller can't park an invisible selection with no row to untoggle); presets (#38) will reuse the same seam. `--fix --yes` applies non-interactively; `--fix --json` is refused (the audit report and the apply flow are different animals). Manual findings are listed as next steps and never executed — their remedies delete or edit things, and --fix's contract is install-only. `runInit` now returns `{ ok }` so --fix can exit 1 on apply failure; a declined prompt or an interrupted install stays ok, only an install that ran and errored reads as failure.
**Alternatives considered:** A dedicated repair executor — rejected; runInit already owns the resolver/plan/guardrail chain and a second path would drift. Executing manual remedies behind a confirmation — rejected; --fix stays install-only.

## 2026-07-06: Milestone-5 shape settled with the maintainer before the build (issues #33-#38)

**Source:** an AskUserQuestion round at milestone-5 planning time, before PR #57; no code.

**Context:** The "1.0 — Close the loop" milestone crosses several one-way doors (a new dependency, an on-disk format, release timing), so they went to the maintainer up front rather than getting decided mid-PR.
**Decision:**

- Sidecar baselines (`.unbranded/baseline/` + README) are update's merge base — chosen over embedding bytes in the envelope or re-fetching old templates from the registry.
- `node-diff3` powers the three-way merge (jsdiff v9 has no merge API).
- Pin-bump automation (#35) runs as a scheduled workflow in this repo, not Renovate.
- **1.0.0 waits for #38 presets.** The Release-As 1.0.0 commit lands after presets, not after #37's agent contract.

**Alternatives considered:** Renovate for the pinned manifest versions — rejected in favor of a scheduled workflow the repo owns. Cutting 1.0.0 once the day-2 verbs (#33-#36) close — rejected; the maintainer wants presets in the 1.0 story.

## 2026-07-05: CI split into parallel jobs — one heavy install per job (issues #55, #56)

**Source:** commits 7dd2df7 (#55) and b2f5605 (#56) on main; a wall-clock optimization with no product behavior change.

**Context:** `ci.yml` ran typecheck/lint/unit/build then the whole e2e serially across a 2x2 matrix, so the fast checks sat in front of the slow real-install e2e and the run waited on the slowest Windows leg. Profiling the merged split showed the e2e time was almost entirely one file: `eslint-flavors.spec` runs three real installs (~55s each on Windows) and `scaffold-lint.spec` one more, and vitest sharding can't break a single file apart.
**Decision:** Fan the work into independent jobs. `checks` keeps the full node-{22,24} x {ubuntu,windows} grid (node-version behavior — `styleText`, `parseArgs` — is what those legs guard). `e2e-main` runs every non-heavy spec on a 3-cell matrix (drops windows-24) with the two heavy specs self-skipping via `UB_E2E_LEG=main`. `e2e-flavors` fans base/react/next out, one real install per job, via `UB_FLAVOR`. `e2e-scaffold` runs the full-project lint. `launcher-smoke` runs the pack-and-co-install check once on linux. Wall-clock is now the slowest single install, not the sum.
**Second change (#56): drop the global `npm install -g npm@latest`** everywhere except launcher-smoke. New shared helper `test/e2e/npm-pack.ts` `packedFilePaths()` parses `npm pack --dry-run --json` defensively — node 22's bundled npm prints prepare-hook output ahead of the JSON, so it slices from the first array-of-objects (`[` then `{`, which `[INFO]`-style hook lines never form) before `JSON.parse`. pack.spec/version.spec consume it, so they no longer need a current npm just to parse pack output; launcher-smoke still upgrades because it captures a tarball name from `npm pack --silent`.
**Alternatives considered:** vitest `--shard` to split the slow suite — rejected; a file's tests stay together and the cost is one file. Keeping windows-24 in the grid — dropped from e2e-main; a Windows-specific failure shows on windows-22, a node-24 one on ubuntu-24.

## 2026-07-05: A fresh scaffold lints clean under the shipped ESLint config (issue #48, PR #54)

**Source:** commit 1572975 (#54), closing the #48 follow-up filed during the TUI batch; the last loose end of milestone #4.

**Context:** A brand-new scaffold's `package.json` and `.unbranded.json` failed the very ESLint config the tool ships (antfu's `jsonc/sort-keys` and `jsonc/indent`), so `eslint .` wasn't clean until a `--fix` pass — a poor first impression for a tool whose pitch is lint-clean tooling.
**Decision:**

- **Key order.** `merge-json.ts` `TOP_LEVEL_ORDER` retargeted to antfu's exact `sortPackageJson` order — the quirks that bit us are `type` before `version`, and `packageManager`/`private` before `description` — so `jsonc/sort-keys` accepts our output with no fix pass. Nested keys already matched antfu's asc requirement. Decided with the maintainer: align order for BOTH new and augment mode, since `mergePackageJson` already canonicalized order in both.
- **Indent.** `install/run.ts` seeds a fresh `package.json` with tab indent (augment mode still detects and respects the user's existing indent, so we never reformat their file). `state/state.ts` `serializeState` writes `.unbranded.json` tab-indented unconditionally — it's entirely unbranded-owned, so there's no user formatting to preserve.

**Test:** `test/e2e/scaffold-lint.spec.ts` — fresh empty dir, real install, drop the invocation recipe, then full `eslint .` over the whole scaffold expects zero problems. Writer-level guards on tab indent and type-before-version point a failure at the serializer, not eslint.
**Alternatives considered:** Aligning key order only for new-project mode — rejected; the merge already canonicalized both modes, so splitting them would be the odd case out.

## 2026-07-05: F-07 — one shared color policy honoring NO_COLOR and --no-color/--color (issue #32, PR #52)

**Source:** issue #32 (F-07), merged as PR #52 (commit 7f4c8c3); the last milestone-4 feature.

**Context:** The diff colorizer hardcoded red/green ANSI with no opt-out, so `diff --diff` and `--dry-run --diff` spat raw escape codes into a pipe, and nothing honored NO_COLOR. F-07 makes color one decision the whole CLI shares.
**Decision:** New `src/util/color.ts` centralizes it. A pure `computeColorEnabled({ env, argv, isTTY })` fixes the precedence — an explicit off (`NO_COLOR`/`--no-color`) beats an explicit on (`FORCE_COLOR`/`--color`) beats the stream — and DELIBERATELY drops picocolors' habit of forcing color under CI, so a piped run stays plain enough to redirect into a file or another program. A pure `colorEnvPatch` translates that policy into the `NO_COLOR`/`FORCE_COLOR` env, and `applyColorPolicy()` applies it once at `cli.ts` startup. The diff colorizer (`renderPlanDiff`/`colorizeDiff` in `src/fs/copy.ts`) now gates on `colorEnabled()`; with color off it hands back the plain unified patch, which already carries +/-/@@ prefixes. New `--no-color`/`--color` flags registered in `parseArgs` and documented in `--help`.
**Load-bearing insight:** clack 1.4.0 colors through node's `util.styleText`, which reads `NO_COLOR`/`FORCE_COLOR` live on every call — NOT picocolors, whose color decision freezes at import. So `applyColorPolicy()` needs no import-order or launcher trick; it only has to run before the first styled write. styleText ignores argv, so the env patch is what bridges `--no-color`/`--color` (and forcing color over a pipe via `FORCE_COLOR=1`) into the two vars it does read.
**Test:** `test/e2e/no-color.spec.ts` asserts zero escape codes on piped `list`/`diff`/`doctor`/`--dry-run --diff` (the drift and dry-run cases render a real patch first, so the check runs against actual content), and pins the escape hatches — `--color` forces over a pipe, `FORCE_COLOR` keeps it, `--no-color` wins over `FORCE_COLOR`.
**Alternatives considered:** An import-order or launcher trick to set env before clack loads — unnecessary once clack turned out to use styleText's live read, not picocolors' frozen decision. Keeping picocolors' CI-forces-color heuristic — rejected; it would defeat script-safe piped output, the whole point of the flag.

## 2026-07-05: Milestone-4 TUI batch — plan provenance, installed badges, filterable unit picker (issues #28-#31)

**Source:** PRs #49 (issue #30), #50 (issue #28), #51 (issues #31 + #29), all merged to main; the ergonomics half of the Trust milestone. Closes #28/#29/#30/#31.

**Context:** v0.4 selection was `groupMultiselect` — no way to filter a growing catalog, no signal for what's already installed, no explanation for units that show up in the plan without being picked, and eslint flavor lived in a separate post-selection prompt. These four issues fold selection into one screen.
**Decision:**

- **Provenance (#30, PR #49).** `resolveSelection` now returns `requiredBy: Partial<Record<UnitId, UnitId>>` next to `auto`, mapping each auto-added unit to its _nearest_ requirer. Nearest is a free consequence of first-writer-wins recorded at the `implies` add site: a `Set` visits mid-iteration additions in insertion order, so for A→B→C, C is reached while iterating B and gets attributed to B, not A. `formatPlan` renders `(auto — required by <label>)`, with a bare `(auto)` defensive fallback for the case where `auto` and `requiredBy` ever disagree.
- **Installed badges (#28, PR #50).** New `src/detect/installed.ts` `detectInstalledUnits({ cwd, units })`, layered: the `.unbranded.json` state file wins when present (the exact resolved ids a prior run wrote), else filesystem probes. The three file-less units get side channels — core-tailwind→dep, core-node-version→node pin, core-eslint→`eslint.config.mjs` — everything else is `files.every(exists)`. Badges are a hint, never a gate, so every probe under-claims rather than risk a false badge. Doctor's read-only probes were first extracted to `src/detect/signals.ts` (`hasDep`/`hasScript`/`engines`/`hasNodeVersionPin`/`effectiveDest`) and shared, with an untouched `doctor.spec.ts` as the regression net. AC deviation: a dedicated presence module instead of reusing doctor's absence-only findings, which cover only 7/15 units.
- **Filterable picker (#31 + #29, PR #51).** New `src/prompts/unit-picker/{options,state,render,prompt}.ts` — a custom multi-select on `@clack/core` (added as a direct dep pinned `1.3.1`, the _same instance_ as `@clack/prompts` so the cancel symbol, `isCancel`, and the `settings` singleton are shared). Substring filter (label/id/group), Tab detail expansion, live implies preview (reusing #30's `requiredBy`), inline eslint-flavor cycling with ←/→, live summary footer, styled category headers with counts. `init.ts` calls `unitPicker` instead of `groupMultiselect`; the picker's chosen flavors thread into `resolveUnitOptions`, so the old post-picker flavor `select` is gone, and #50's `buildPickerOptions` was deleted (the badge moved onto the picker's option model). Non-interactive paths (`--config`/`--units`/`--yes`) stay byte-identical. AC deviation: #29's detail is opt-in on Tab, not always-on, to hold one line per unit.

**Two load-bearing implementation choices:**

- **Pure core / thin shell.** Every picker module is a pure function or reducer (`buildUnitPickerOptions`, `createPickerState`/`reducePicker`/`filteredOptions`/`pickerRows`/`pickerSummary`, `renderUnitPicker`, and a pure `translateKey` table); only `UnitPickerPrompt` touches `@clack/core`. Same split as the `inspectPm`/`detectPm` pattern in conventions, so the whole picker is unit-testable without a terminal.
- **Escape clears then cancels.** `unitPicker()` deletes the `escape` alias from the live `@clack/core` `settings` singleton (restored in `finally`) so escape reaches the prompt's own handler: it clears a live filter first and only cancels an already-empty filter. Ctrl+C keeps its alias and cancels unconditionally.

**Test counts after the batch:** 314 unit + 75 e2e, all green; each new module ships a `.spec.ts`.
**Alternatives considered:** Reusing doctor's findings for badges — rejected; doctor is absence-only and covers under half the units. An always-on detail line per unit (#29 as first framed) — rejected for the per-unit line budget; Tab makes it opt-in. Building the picker on `@clack/prompts` primitives — not viable; a filterable multi-select isn't expressible in the stock prompts, which is why it drops to `@clack/core` (same instance so isCancel/settings stay shared).

## 2026-07-05: F-02 ESLint flavors — computed config delivered inline, baked by declarative unit options (issue #27, PR #47)

**Source:** issue #27 (F-02), merged as PR #47; the third milestone-4 feature and the base the picker's inline flavor cycling builds on.

**Context:** `core-eslint` shipped one static `eslint.config.mjs` that opted into `react`/`nextjs`, so every scaffold pulled React/Next peers even for a plain Node project. F-02 makes the flavor (base/react/next) a real choice offered everywhere — `--units`, `--config`, and the interactive picker.
**Decision:** The eslint config now _varies_ by flavor, so it's generated by `buildEslintConfig(flavor)` (`src/manifest/eslint-config.ts`) and delivered inline through a new `FileOp.content` (mutually exclusive with `src`), which still rides the same conflict / dry-run / state-hashing pipeline a copied file gets. A declarative `Unit.options` (`UnitOption`/`UnitOptionChoice` in `types.ts`) plus a pure `applyUnitOptions` (`src/manifest/options.ts`) bake the chosen flavor into a concrete unit before the plan/copy/install pipeline runs, so nothing downstream sees an option. Base flavor pulls zero React packages. F-14 (#40) formalizes `Unit.options` into the published unit schema; until then it stays plain data.
**Alternatives considered:** Three static config templates (base/react/next) — rejected via a maintainer question for the duplication; computed content keeps one source. Branching the runtime on flavor instead of a declarative option — rejected against the "manifest is data" convention.

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
