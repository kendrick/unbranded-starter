# opt-in: monorepo

Drop these into a new monorepo to get pnpm workspaces + Turbo.

## What to copy

- `pnpm-workspace.yaml` → repo root
- `turbo.json` → repo root
- Add `turbo` as a root `devDependency`: `pnpm add -D -w turbo`
- Edit root `package.json` scripts to delegate to turbo:
  ```json
  {
  	"scripts": {
  		"dev": "turbo dev",
  		"build": "turbo build",
  		"test": "turbo test",
  		"lint": "turbo lint",
  		"typecheck": "turbo typecheck"
  	}
  }
  ```

## Layout convention

```
.
├── apps/         # Deployable things (Next app, Storybook, etc.)
└── packages/     # Shared things (ui, tokens, eslint, types, etc.)
```

## Notes

- The workspace yaml carries build-script approvals (`onlyBuiltDependencies` for pnpm 10, `allowBuilds` for pnpm 11) so native packages like esbuild and sharp actually build. Commit it: on pnpm 11 an un-approved build stops `pnpm install`, so leaving it out breaks every fresh clone and CI run.
- `tsconfig.base.json` (from the starter root) sits at repo root; each workspace's `tsconfig.json` extends it.
- `eslint.config.mjs` typically lives at repo root and applies to all workspaces. Per-workspace overrides go in workspace-level `eslint.config.mjs`.
- For TypeScript project references (`references` array), add them per-workspace; see `unbranded-ds` or `nextera-livewire` for examples.
