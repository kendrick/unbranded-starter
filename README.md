```
◦◦    ◦◦ ◦◦    ◦◦ ◦◦◦◦◦◦◦  ◦◦◦◦◦◦◦     ◦◦    ◦◦    ◦◦ ◦◦◦◦◦◦   ◦◦◦◦◦◦◦◦ ◦◦◦◦◦◦
◦◦    ◦◦ ◦◦◦   ◦◦ ◦◦   ◦◦  ◦◦   ◦◦    ◦◦◦◦   ◦◦◦   ◦◦ ◦◦   ◦◦  ◦◦       ◦◦   ◦◦
◦◦    ◦◦ ◦◦◦◦  ◦◦ ◦◦   ◦◦  ◦◦   ◦◦   ◦◦  ◦◦  ◦◦◦◦  ◦◦ ◦◦    ◦◦ ◦◦       ◦◦    ◦◦
◦◦    ◦◦ ◦◦ ◦◦ ◦◦ ◦◦◦◦◦◦◦  ◦◦◦◦◦◦◦  ◦◦    ◦◦ ◦◦ ◦◦ ◦◦ ◦◦    ◦◦ ◦◦◦◦◦◦   ◦◦    ◦◦
◦◦    ◦◦ ◦◦  ◦◦◦◦ ◦◦   ◦◦  ◦◦ ◦◦    ◦◦◦◦◦◦◦◦ ◦◦  ◦◦◦◦ ◦◦    ◦◦ ◦◦       ◦◦    ◦◦
◦◦    ◦◦ ◦◦   ◦◦◦ ◦◦   ◦◦  ◦◦  ◦◦   ◦◦    ◦◦ ◦◦   ◦◦◦ ◦◦   ◦◦  ◦◦       ◦◦   ◦◦
 ◦◦◦◦◦◦  ◦◦    ◦◦ ◦◦◦◦◦◦◦  ◦◦   ◦◦  ◦◦    ◦◦ ◦◦    ◦◦ ◦◦◦◦◦◦   ◦◦◦◦◦◦◦◦ ◦◦◦◦◦◦
                                               u n b r a n d e d ◦ s t a r t e r
```

# unbranded

An interactive CLI that adds project tooling to any directory or repo, using whichever package manager you already have. Eleven installable units across a bunch of categories. Pinned versions by default, `--latest` opts out per run.

## Quickstart

```bash
npx unbranded
```

Run inside a directory that already has a `package.json` and it augments that project in place. Run anywhere else and it asks for a project name, then creates and enters the new directory. The CLI detects your package manager based on its lockfile (priority: pnpm → bun → yarn → npm) and asks what you'd like to install.

A run looks roughly like this:

```
┌  unbranded
│
●  Target: ~/code/my-app (augment)
●  Package manager: pnpm
│
◇  What do you want to install?
│  [Foundation] EditorConfig + .nvmrc
│  [Linting]    ESLint
│  [TypeScript] TypeScript
│  [Styles]     Tailwind v4
│  …
│
□  Plan
│  • ESLint
│  • TypeScript (auto)
│  2 units · 3 files · 7 deps · install via pnpm
│
◇  Apply? Yes
│
●  Files: 3 written, 0 overwritten, 0 skipped.
│
○  Installing dependencies via pnpm
│
└  Done.
```

## What you can install

**Foundations**

- EditorConfig + `.nvmrc`. Cross-editor whitespace rules and a Node version pin.

**Linting**

- ESLint. `@antfu/eslint-config` base with React, Next.js, TypeScript, and a 28-rule jsx-a11y strict block. Tabs and single quotes by default, with arrow parens always. Handles JS/TS/JSON/MD/YAML/CSS/HTML formatting through `eslint-plugin-format`.

**TypeScript**

- TypeScript. The full strict suite plus `noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters`, `verbatimModuleSyntax`, `noImplicitReturns`, and `noFallthroughCasesInSwitch`.

**Styles**

- Stylelint. Standard config with a Tailwind-aware preset; Tailwind v4 directives allowed.
- Tailwind v4. No JS config file; add `@import "tailwindcss";` to your stylesheet.
- PostCSS. One-line config that loads `@tailwindcss/postcss`.

**Testing**

- Vitest. jsdom environment with common excludes.

**End-to-End**

- Playwright + axe. Mobile-first device matrix with `@axe-core/playwright` wired right up.

**UI**

- shadcn/ui scaffolding. `components.json` plus the `cn()` utility at `src/lib/utils.ts`.

**Git hooks**

- Husky + lint-staged. Pre-commit hook that runs lint-staged on changed files.

**Monorepo tooling**

- pnpm workspace + Turbo. Workspace yaml (with `onlyBuiltDependencies` for esbuild/sharp/unrs-resolver) and a turbo.json baseline.

A few units pull others in automatically. Selecting ESLint auto-includes TypeScript; selecting shadcn/ui or PostCSS auto-includes Tailwind. The resolved set is shown in the plan summary before anything gets written.

## How it works

1. **Target detection.** If `cwd` has a `package.json`, the CLI augments that project. Otherwise it asks for a project name and works inside the new directory it creates.
2. **Package manager detection.** Walks up looking for `pnpm-lock.yaml`, `bun.lock(b)`, `yarn.lock`, or `package-lock.json`. Without a lockfile, the CLI tries the `packageManager` field next, then `npm_config_user_agent`. A select prompt is the last resort. If there's no `package.json` at all, files get written but install is skipped, and a "next steps" block tells you what to run.
3. **Selection.** A Clack `groupMultiselect` organized by category offers intuitive navigation and selection, with unit descriptions as hints.
4. **Resolution.** Closes the selection under `implies` (fixed-point iteration), then validates `requires`. Anything that violates an `excludes` rule fails fast. Auto-added units are tagged `(auto)` in the summary.
5. **Preview.** A note shows the units, file count, dep count, and install command.
6. **Apply on confirm.** Each file that already exists triggers an overwrite-or-skip prompt; a "show diff" option renders the conflict as a colored unified patch and re-prompts. The merged `package.json` lands with stable key ordering and alphabetized deps.
7. **Install.** The detected package manager is spawned with a SIGINT trap. Ctrl-C kills the child cleanly and prints a rerun hint instead of leaving the project half-done.
8. **Post-install hooks.** Per-unit confirms for things like `husky init` (gated on `.git/` existing) and `playwright install`. Each hook gets its own prompt with a sensible default.

## Non-interactive mode

For CI and reproducible recipes:

```bash
unbranded --config recipe.json
```

Recipe shape:

```json
{
	"units": ["core-eslint", "core-vitest"],
	"pm": "pnpm",
	"onConflict": "overwrite",
	"postInstall": "all",
	"projectName": "my-app"
}
```

| Field         | Description                                                             |
| ------------- | ----------------------------------------------------------------------- |
| `units`       | Array of `UnitId` strings. Unknown ids fail validation immediately.     |
| `pm`          | One of `"npm"`, `"pnpm"`, `"yarn"`, `"bun"`, or `null` to skip install. |
| `onConflict`  | `"overwrite"` or `"skip"` for every file collision.                     |
| `postInstall` | `"all"` or `"none"` for every per-unit hook.                            |
| `projectName` | Required only when `cwd` has no `package.json` (new-project mode).      |

Config mode skips the "Apply" confirmation.

## Requirements

Node 24 or newer.

## Philosophy

- **`@antfu/eslint-config` over `eslint-config-next`** alone. @antfu gives uniform style + a11y + formatting across many bodies of work, not just Next projects.
- **Tabs over spaces** because @antfu does tabs and I'm not picking that fight.
- **`@antfu` does the formatting for code; Prettier is scoped to markdown only.** `@antfu/eslint-config` bundles `eslint-plugin-format` (dprint) for JS/TS/JSON/YAML/CSS/HTML. Prettier and dprint disagree on small persistent things (quote handling, key quoting), and I found that running both on code makes them fight each other. `pnpm lint` is the only thing CI runs for code. Editor format-on-save is wired to ESLint for code, Prettier for markdown only (via `.vscode/settings.json` per-language formatters) because Prettier's prose-wrap and list reflow are noticeably better than dprint's in my opinion. Markdown isn't in CI; it's an editor-only formatter for now. `.editorconfig` covers basics for editors without an ESLint integration.
- **Stylelint exists** even on tiny projects. The same config works everywhere.
- **Strict TypeScript is non-negotiable.** `noUncheckedIndexedAccess` catches the bugs the basic `strict` flag misses.
- **`.vscode/` is committed.** If you work in VS Code, a clone of the repo should "just work."
- **Mobile-first when testing.** Opt-in Playwright config defaults to Pixel + iPhone profiles.

## Manual clone

The CLI is the recommended path, but the repo itself works as a template if you'd rather hand-pick files:

```bash
# Copy locally
cp -r ~/repos/unbranded-starter ~/repos/new-project
cd ~/repos/new-project && rm -rf .git && git init

# Or degit (after pushing to GitHub)
pnpm dlx degit kendrick/unbranded-starter new-project
```

Then take what you want from the root configs and the `opt-in/` directories.

## License

MIT
