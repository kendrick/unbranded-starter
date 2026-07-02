# Open Questions

<!-- Things that are unresolved and should not be guessed at. -->
<!-- Agents encountering these should ask rather than assume. -->

- **`--latest` is documented but not implemented** (tracked as issue #3). `README.md` and the `src/manifest/index.ts` comment describe `unbranded --latest` as the escape hatch from pinned versions, but `src/cli.ts` `parseArgs` defines no `latest` option, so passing it today errors. Design is settled: write the `latest` dist-tag for every dep/devDep, plus a `versions` recipe field for parity. This resolves when #3 lands; don't change version behavior outside that issue.
- **YAML `--config` support (v1.1?).** `src/config/load.ts` is deliberately JSON-only in v1. Confirm this is wanted before building it.
- **Installing into a workspace leaf (v1.1?).** In augment mode `detectPm` still throws for `workspace-leaf` and tells the user to re-run from the workspace root. (As of #2, new-project mode no longer refuses a workspace leaf, so a brand-new isolated subdirectory is allowed.) Whether/how to support nested-package installs in augment mode is undecided — don't design it without confirmation.
