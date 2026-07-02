# Open Questions

<!-- Things that are unresolved and should not be guessed at. -->
<!-- Agents encountering these should ask rather than assume. -->

- **`--latest` is documented but not implemented.** `README.md` and the `src/manifest/index.ts` comment both describe `unbranded --latest` as the escape hatch from pinned versions, but `src/cli.ts` `parseArgs` defines no `latest` option and uses `allowPositionals: false` — so passing `--latest` today would error. Ask before acting: implement the flag, or correct the docs?
- **YAML `--config` support (v1.1?).** `src/config/load.ts` is deliberately JSON-only in v1. Confirm this is wanted before building it.
- **Installing into a workspace leaf (v1.1?).** `detectPm` currently throws for `workspace-leaf` and tells the user to re-run from the workspace root. Whether/how to support nested-package installs is undecided — don't design it without confirmation.
