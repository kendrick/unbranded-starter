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

`src/manifest/types.ts` — `UnitId`, `Category`, `FileOp`, `PostInstall`, `Unit`, plus `UnitOption`/`UnitOptionChoice`. Every installable unit is a `Unit`; the registry `UNITS` lives in `src/manifest/index.ts`. Adding a unit means adding a `Unit` there and (usually) a `UnitId` member. `FileOp.dest` is target-cwd-relative and supports `{projectName}` interpolation; a `FileOp` carries exactly one of `src` (`PKG_ROOT`-relative posix, static template) or `content` (inline, computed at selection time — core-eslint's flavored config uses this). A `Unit` may declare `options: UnitOption[]` (variant axes, e.g. core-eslint's base/react/next flavor); a pure `applyUnitOptions` (`src/manifest/options.ts`) bakes the chosen values into a concrete unit before the plan/copy/install pipeline runs, so downstream never sees an option.

## Selection resolution

`src/manifest/resolve.ts` — `ResolveResult` is a tagged union: `{ kind: 'ok', ids, auto, requiredBy }` | `{ kind: 'missing-required', unit, needs }` | `{ kind: 'conflict', pair }`. `requiredBy: Partial<Record<UnitId, UnitId>>` maps each auto-added unit to its nearest requirer (first-writer-wins at the `implies` add site), consumed by `formatPlan` for the `(auto — required by X)` provenance line. `resolveSelection()` is pure: it closes the seed under `implies` (fixed-point), then validates `requires` and (symmetric) `excludes`.

## `--config` recipe (external contract)

`src/config/load.ts` — `Config` = `{ units: UnitId[]; pm: Pm | null; onConflict: 'overwrite' | 'skip'; postInstall: 'all' | 'none'; projectName?: string }`. `validate()` is the source of truth for what a recipe JSON may contain; unknown `units` ids fail immediately. `projectName` is required only in new-project mode. This is also documented as a table in `README.md`. v1 is JSON-only.

## Detection results

- `src/detect/pm.ts` — `Pm` (`'npm' | 'pnpm' | 'yarn' | 'bun'`), `PmSource`, and `PmInspection` (tagged union: `detected` | `needs-prompt` | `no-pkg` | `workspace-leaf`).
- `src/detect/target.ts` — `TargetMode` (`'augment' | 'new'`), `TargetContext`, `Inspection`.

## Color policy (shared CLI surface)

`src/util/color.ts` — one decision the whole CLI shares. `computeColorEnabled({ env, argv, isTTY }): boolean` is pure: an explicit off (`NO_COLOR`/`--no-color`) beats an explicit on (`FORCE_COLOR`/`--color`) beats the stream, deliberately WITHOUT picocolors' CI/win32 forcing so piped output stays script-safe. `colorEnabled()` reads live process state; the diff colorizer reads it directly. `colorEnvPatch` translates the policy into `Partial<Record<'NO_COLOR' | 'FORCE_COLOR', string | null>>` (`null` = unset), which `applyColorPolicy()` applies once at `cli.ts` startup so clack's `util.styleText` (a live env read on every call) lands on the same answer.

## State file & machine-readable outputs (agent surface)

These are the shapes agents consume; each carries a `schema` so a reader can key off it rather than field-sniff. See also the "Machine-readable surface" section of `AGENTS.md`.

- `.unbranded.json` — `StateFile` in `src/state/state.ts` (`STATE_SCHEMA` = 1). Records `units` plus a `files` map (dest → sha256) covering every file a run wrote, computed (`.nvmrc`, `.vscode/extensions.json`) or copied. Optional hand-editable `doctor: { ignore: string[] }` block, preserved verbatim across re-scaffolds. `readStateFile` degrades a malformed file to `undefined` instead of throwing. `serializeState` writes it tab-indented (canonical, unbranded-owned) so the scaffold's own `eslint .` passes antfu's `jsonc/indent`.
- `unbranded doctor --json` — `DOCTOR_SCHEMA` = 2 (`src/commands/doctor.ts`): `{ schema, ok, findings, suppressed, ignoredUnknown }`. `findings` and `suppressed` are `Finding[]`; `ignoredUnknown` lists doctor.ignore ids matching no known finding. Schema 2 added `suppressed` and `ignoredUnknown`; `ok` reflects active (unsuppressed) findings only.
- `unbranded diff --json` — `DIFF_SCHEMA` = 1 (`src/commands/diff.ts`): `{ schema, tracked, drift, files: [{ path, status }] }`, `status` ∈ `unchanged | user-modified | template-updated | both`.
- `unbranded list --json` — the unit catalog (`src/commands/list.ts`, `buildCatalog`).
