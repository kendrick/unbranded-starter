# opt-in: ci-github

A GitHub Actions workflow that runs install, lint, typecheck, and test on every push and PR.

## What lands

- `.github/workflows/ci.yml`: one `ubuntu-latest` / Node 22 job on pnpm.

## Notes

- Picking this also pulls in ESLint, TypeScript, and Vitest: the job runs their `lint`, `typecheck`, and `test` scripts, and without those units it fails on a missing script.
- pnpm is baked in. On another package manager, swap the `pnpm/action-setup` step and the `pnpm` run lines.
- `pnpm/action-setup` reads its version from package.json's `packageManager` field, which `core-node-version` writes during scaffolding.
