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
