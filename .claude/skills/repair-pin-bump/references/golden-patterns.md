# Golden Patterns

Shapes from this repo's history that a pin-health change follows. Read the PR named in each before you copy its shape.

## Fix the Shipped File, Then Pin the Fix With an Assertion (#174)

typescript-eslint 8.71.1 flagged `const config = {…}; export default config` under a JSDoc `@type` in the shipped `postcss.config.mjs`. The preset e2e installs without a lockfile, so it picked up 8.71.1, and the scaffold's own `pnpm lint` failed on every open PR, bumps that never touched ESLint included.

The repair changed the shipped file so it lints clean whatever upstream decides (`export default {…}` directly), and stopped the generated lint configs from reading `.unbranded/baseline/`. It added assertions to `src/manifest/eslint-config.spec.ts` and `src/manifest/oxlint-config.spec.ts` that fail without the change. The PR body named the upstream version, the failing job, and the reproduction command, and it listed what wasn't tested locally (the Windows legs).

What to copy:

- Fix the file the scaffold ships or the generator that writes it. Workarounds in the test belong nowhere.
- Make the fix hold under either upstream behavior, so the next patch release can't re-break it.
- Add an assertion that fails before the fix.

## Hold the Line When Upstream Can't Work Here (#131, #151, #165, #178)

TypeScript 7.0.2 shipped no JS compiler API, and two tools in this repo loaded that API. No change inside this repo could make the bump work, so #151 was closed with a comment naming both consumers, and #165 pinned 6.0.3, the newest release inside typescript-eslint's peer range. #178 then taught `outdated` and `bump-pins.mjs` to hold a line-option pin to its major.

What to copy:

- Name each consumer that breaks and the constraint it imposes (a peer range, a missing API).
- Name the newest version that still works, if one exists.
- Record the hold in the memory file. Changing `LINE_OPTIONS` or the bump tooling is a separate issue for a human.
