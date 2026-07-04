# Open Questions

<!-- Things that are unresolved and should not be guessed at. -->
<!-- Agents encountering these should ask rather than assume. -->

- **YAML `--config` support (v1.1?).** `src/config/load.ts` is deliberately JSON-only in v1. Confirm this is wanted before building it.
- **Installing into a workspace leaf (v1.1?).** In augment mode `detectPm` still throws for `workspace-leaf` and tells the user to re-run from the workspace root. (As of #2, new-project mode no longer refuses a workspace leaf, so a brand-new isolated subdirectory is allowed. As of #17, `--pm <pm>` bypasses detection entirely, workspace-leaf refusal included, so a monorepo subpackage can proceed with an explicit PM.) What stays open is auto-detection: whether unbranded should ever install into a nested package _without_ the `--pm` override, and with what semantics — don't design it without confirmation.
- **Roadmap discoverability (F-18-adjacent).** `tmp/roadmap.md` is gitignored, so the F-IDs the new issues cross-reference (each of #25–#44 opens with a `**Roadmap:** F-NN` line) don't resolve for anyone browsing the repo. Flagged to the maintainer that a cleaned copy could move to a committed `ROADMAP.md` or a `docs/` page; no decision made — left to the maintainer.
