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

`src/manifest/types.ts` — `UnitId`, `Category`, `FileOp`, `PostInstall`, `Unit`. Every installable unit is a `Unit`; the registry `UNITS` lives in `src/manifest/index.ts`. Adding a unit means adding a `Unit` there and (usually) a `UnitId` member. `FileOp.src` is `PKG_ROOT`-relative posix; `FileOp.dest` is target-cwd-relative and supports `{projectName}` interpolation.

## Selection resolution

`src/manifest/resolve.ts` — `ResolveResult` is a tagged union: `{ kind: 'ok', ids, auto }` | `{ kind: 'missing-required', unit, needs }` | `{ kind: 'conflict', pair }`. `resolveSelection()` is pure: it closes the seed under `implies` (fixed-point), then validates `requires` and (symmetric) `excludes`.

## `--config` recipe (external contract)

`src/config/load.ts` — `Config` = `{ units: UnitId[]; pm: Pm | null; onConflict: 'overwrite' | 'skip'; postInstall: 'all' | 'none'; projectName?: string }`. `validate()` is the source of truth for what a recipe JSON may contain; unknown `units` ids fail immediately. `projectName` is required only in new-project mode. This is also documented as a table in `README.md`. v1 is JSON-only.

## Detection results

- `src/detect/pm.ts` — `Pm` (`'npm' | 'pnpm' | 'yarn' | 'bun'`), `PmSource`, and `PmInspection` (tagged union: `detected` | `needs-prompt` | `no-pkg` | `workspace-leaf`).
- `src/detect/target.ts` — `TargetMode` (`'augment' | 'new'`), `TargetContext`, `Inspection`.

## State file & machine-readable outputs (agent surface)

These are the shapes agents consume; each carries a `schema` so a reader can key off it rather than field-sniff. See also the "Machine-readable surface" section of `AGENTS.md`.

- `.unbranded.json` — `StateFile` in `src/state/state.ts` (`STATE_SCHEMA` = 1). Records `units` plus a `files` map (dest → sha256) covering every file a run wrote, computed (`.nvmrc`, `.vscode/extensions.json`) or copied. Optional hand-editable `doctor: { ignore: string[] }` block, preserved verbatim across re-scaffolds. `readStateFile` degrades a malformed file to `undefined` instead of throwing.
- `unbranded doctor --json` — `DOCTOR_SCHEMA` = 2 (`src/commands/doctor.ts`): `{ schema, ok, findings, suppressed, ignoredUnknown }`. `findings` and `suppressed` are `Finding[]`; `ignoredUnknown` lists doctor.ignore ids matching no known finding. Schema 2 added `suppressed` and `ignoredUnknown`; `ok` reflects active (unsuppressed) findings only.
- `unbranded diff --json` — `DIFF_SCHEMA` = 1 (`src/commands/diff.ts`): `{ schema, tracked, drift, files: [{ path, status }] }`, `status` ∈ `unchanged | user-modified | template-updated | both`.
- `unbranded list --json` — the unit catalog (`src/commands/list.ts`, `buildCatalog`).
