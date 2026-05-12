# opt-in: shadcn/ui

Drop-in shadcn config + `cn()` helper.

## When to use

- Any Next.js + Tailwind project using shadcn components.

## Setup

1. Install:
   ```sh
   pnpm add clsx tailwind-merge
   pnpm add -D shadcn
   ```
2. Copy `components.json` to repo root.
3. Copy `lib-utils.ts` to `lib/utils.ts` in your project.
4. (Optional) Initialize via the shadcn CLI if you want to add components interactively:
   ```sh
   pnpm dlx shadcn@latest add button slider toggle
   ```

## Notes

- The `aliases.ui` path is `@/components/ui` — make sure your `tsconfig.json` has `"paths": { "@/*": ["./*"] }` (or `./src/*` for src-dir layouts).
- ESLint's `ignores` array already excludes `src/components/ui` (shadcn-generated code shouldn't be linted).
- The `iconLibrary` is set to `lucide` — change in `components.json` if you prefer another.
