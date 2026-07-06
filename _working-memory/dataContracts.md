# Data Contracts

<!-- Canonical shapes for data flowing through the application. -->
<!-- Agents must consume data through these contracts. -->
<!-- When mocking data, conform to these shapes exactly. -->

<!-- Three valid formats — pick whichever survives drift best:               -->
<!--   1. POINTER. Link to the source-of-truth file(s). Best for typed       -->
<!--      projects where the code IS the contract — TypeScript interfaces,   -->
<!--      Pydantic models, Zod schemas. Duplicating types here just creates  -->
<!--      drift.                                                              -->
<!--   2. SCHEMA SKETCH. Paste a JSON-schema / OpenAPI / GraphQL excerpt.    -->
<!--      Best for API surfaces defined outside the code.                    -->
<!--   3. PROSE. Describe the shape in human-readable form. Best for         -->
<!--      boundaries the code doesn't enforce — file formats, message       -->
<!--      payloads from external systems, naming conventions.                -->
<!-- Mix and match per contract; not every contract needs the same format.  -->

This is a typed project, so the code IS the contract. Consume these through the TypeScript types rather than duplicating shapes here.

## Manifest (the core contract)

`src/manifest/types.ts` — `UnitId`, `Category`, `FileOp`, `PostInstall`, `Unit`, plus `UnitOption`/`UnitOptionChoice`. Every installable unit is a `Unit`; the registry `UNITS` lives in `src/manifest/index.ts`. Adding a unit means adding a `Unit` there and (usually) a `UnitId` member. `FileOp.dest` is target-cwd-relative and supports `{projectName}` interpolation; a `FileOp` carries exactly one of `src` (`PKG_ROOT`-relative posix, static template) or `content` (inline, computed at selection time — core-eslint's flavored config uses this). A `Unit` may declare `options: UnitOption[]` (variant axes, e.g. core-eslint's base/react/next flavor); a pure `applyUnitOptions` (`src/manifest/options.ts`) bakes the chosen values into a concrete unit before the plan/copy/install pipeline runs, so downstream never sees an option. A `Unit` may also declare `removeNotes` — a next-steps line `unbranded remove` prints for side effects it can't undo (opt-husky's `core.hooksPath` note).

## Selection resolution

`src/manifest/resolve.ts` — `ResolveResult` is a tagged union: `{ kind: 'ok', ids, auto, requiredBy }` | `{ kind: 'missing-required', unit, needs }` | `{ kind: 'conflict', pair }`. `requiredBy: Partial<Record<UnitId, UnitId>>` maps each auto-added unit to its nearest requirer (first-writer-wins at the `implies` add site), consumed by `formatPlan` for the `(auto — required by X)` provenance line. `resolveSelection()` is pure: it closes the seed under `implies` (fixed-point), then validates `requires` and (symmetric) `excludes`. `dependentsOf(target, installed, units)` runs the same closure in reverse — which installed units reach `target` via implies/requires — feeding `unbranded remove`'s dependents refusal and `--cascade`.

## `--config` recipe (external contract)

`src/config/load.ts` — `Config` = `{ units: UnitId[]; pm: Pm | null; onConflict: 'overwrite' | 'skip'; postInstall: 'all' | 'none'; projectName?: string }`. `validate()` is the source of truth for what a recipe JSON may contain; unknown `units` ids fail immediately. `projectName` is required only in new-project mode. This is also documented as a table in `README.md`. v1 is JSON-only.

## Detection results

- `src/detect/pm.ts` — `Pm` (`'npm' | 'pnpm' | 'yarn' | 'bun'`), `PmSource`, and `PmInspection` (tagged union: `detected` | `needs-prompt` | `no-pkg` | `workspace-leaf`).
- `src/detect/target.ts` — `TargetMode` (`'augment' | 'new'`), `TargetContext`, `Inspection`.

## Color policy (shared CLI surface)

`src/util/color.ts` — one decision the whole CLI shares. `computeColorEnabled({ env, argv, isTTY }): boolean` is pure: an explicit off (`NO_COLOR`/`--no-color`) beats an explicit on (`FORCE_COLOR`/`--color`) beats the stream, deliberately WITHOUT picocolors' CI/win32 forcing so piped output stays script-safe. `colorEnabled()` reads live process state; the diff colorizer reads it directly. `colorEnvPatch` translates the policy into `Partial<Record<'NO_COLOR' | 'FORCE_COLOR', string | null>>` (`null` = unset), which `applyColorPolicy()` applies once at `cli.ts` startup so clack's `util.styleText` (a live env read on every call) lands on the same answer.

## State file & machine-readable outputs (agent surface)

These are the shapes agents consume; each carries a `schema` so a reader can key off it rather than field-sniff. See also the "Machine-readable surface" section of `AGENTS.md`.

- `.unbranded.json` — `StateFile` in `src/state/state.ts` (`STATE_SCHEMA` = 2). Schema 2 keeps the v1 `units` + `files` (dest → sha256) shape byte-compatible and adds optional sibling maps: `options` (the run's resolved unit options), `attribution` (rel → owning unit, recorded at write time), and `modes` (rel → `TrackedFileMode`: `copy | merge-json | append-if-missing | computed`). A `.unbranded/` sidecar rides next to it: `baseline/` holds byte-exact copies of copy-mode files (`unbranded update`'s merge base) plus a README saying why to commit it; stray baselines are pruned. Mutation goes through three doors: `writeStateFile` MERGES with the prior envelope (only grows the tracked set), `applyRemovalToState` is the only shrink (removing the last unit deletes envelope + sidecar), and `refreshTrackedFiles` is update's hash/baseline refresh. The hand-editable `doctor: { ignore: string[] }` block is still preserved verbatim; `readStateFile` still degrades a malformed file to `undefined`; serialization stays tab-indented and key-sorted (canonical, unbranded-owned).
- `unbranded doctor --json` — `DOCTOR_SCHEMA` = 2 (`src/commands/doctor.ts`): `{ schema, ok, findings, suppressed, ignoredUnknown }`. `findings` and `suppressed` are `Finding[]`; `ignoredUnknown` lists doctor.ignore ids matching no known finding. Schema 2 added `suppressed` and `ignoredUnknown`; `ok` reflects active (unsuppressed) findings only.
- `unbranded diff --json` — `DIFF_SCHEMA` = 1 (`src/commands/diff.ts`): `{ schema, tracked, drift, files: [{ path, status }] }`, `status` ∈ `unchanged | user-modified | template-updated | both`.
- `unbranded list --json` — the unit catalog (`src/commands/list.ts`, `buildCatalog`).

## Day-2 plan shapes (remove / update)

Both planners are filesystem-in/plan-out (the auditRepo pattern); only their `run*` shells write.

- `src/commands/remove.ts` — `RemovalPlan`: `units` (the target plus dependents under `--cascade`), `deletions: { rel, modified }[]` (modified = disk no longer matches the recorded hash), `retained` (merge-json/append files that stay on disk, just untracked), `pkg: PackageJsonRemoval` (`src/fs/merge-json.ts` — deps ref-counted by name, scripts carry expected values so rewrites survive), `manualPkg` (engines/packageManager steps), `notes` (the units' `removeNotes`).
- `src/commands/update.ts` — `UpdatePlanResult` = `{ files: UpdateFilePlan[]; pkg: UpdatePkgPlan }`. `UpdateFileStatus` ∈ `up-to-date | clean-update | merged | conflict | needs-choice | template-gone | user-deleted | computed`; the first four are `src/fs/merge3.ts`'s `UpdateStatus`, derived by `computeUpdate({ base, mine, theirs })`, the rest are the no-baseline and report-only degradations. `UpdateFilePlan` carries `proposed` (what an apply writes), `theirs` (the current template render — kept because keep-mine still advances the baseline), and `existing` (for `--diff`).
- `src/fs/merge3.ts` — `merge3` returns `{ result: 'clean' | 'conflict', merged, conflicts? }`; conflict markers are labeled `yours`/`template`. This wrapper is the only importer of `node-diff3`.
