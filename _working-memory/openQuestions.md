# Open Questions

<!-- Things that are unresolved and should not be guessed at. -->
<!-- Agents encountering these should ask rather than assume. -->

- **YAML `--config` support (v1.1?).** `src/config/load.ts` is deliberately JSON-only in v1. Confirm this is wanted before building it.
- **Installing into a workspace leaf (v1.1?).** In augment mode `detectPm` still throws for `workspace-leaf` and tells the user to re-run from the workspace root. (As of #2, new-project mode no longer refuses a workspace leaf, so a brand-new isolated subdirectory is allowed.) Whether/how to support nested-package installs in augment mode is undecided — don't design it without confirmation.
