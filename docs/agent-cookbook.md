# The Agent Cookbook

Every command in this walkthrough runs without a TTY and speaks JSON. The shapes are versioned—each envelope carries an integer `schema` field, and the matching JSON Schemas ship with the package under `schemas/`—so you can build on them without sniffing fields. The contract summary lives in [AGENTS.md](../AGENTS.md); this document is the loop end to end, with transcripts.

The scenario: you're an agent dropped into a repo, asked to bring its tooling up to scratch and keep it there.

## 1. Audit

```bash
unbranded doctor --json
```

```json
{
	"schema": 2,
	"ok": false,
	"findings": [
		{
			"id": "missing-editorconfig",
			"message": "No .editorconfig, so editors won't agree on whitespace.",
			"fix": "Run `unbranded --units core-editorconfig` to add it.",
			"unit": "core-editorconfig"
		},
		{
			"id": "multiple-lockfiles",
			"message": "Multiple lockfiles present (pnpm-lock.yaml, yarn.lock); detection would pick pnpm-lock.yaml.",
			"fix": "Keep pnpm-lock.yaml and remove the others: yarn.lock."
		}
	],
	"suppressed": [],
	"ignoredUnknown": []
}
```

The split that matters: a finding **with** a `unit` can be closed by installing that unit; a finding **without** one needs a human (or your own judgment)—deleting a lockfile isn't something the CLI will ever do for you. Exit is 0 either way; add `--strict` when you want findings to gate.

Collect the fixable set:

```bash
unbranded doctor --json | jq -r '[.findings[].unit | select(.)] | unique | join(",")'
# core-editorconfig
```

## 2. Preview

Never apply blind. The plan envelope shows exactly what a run would do, including the units the resolver pulls in that you didn't name:

```bash
unbranded --dry-run --json --units core-editorconfig,opt-shadcn --pm pnpm
```

```json
{
	"schema": 1,
	"target": { "dir": "/work/repo", "mode": "augment" },
	"pm": "pnpm",
	"units": ["core-editorconfig", "core-tailwind", "opt-shadcn"],
	"auto": ["core-tailwind"],
	"files": [
		{ "path": ".editorconfig", "action": "create" },
		{ "path": "components.json", "action": "create" },
		{ "path": "src/lib/utils.ts", "action": "create" }
	]
}
```

`auto` names what `implies` dragged in (shadcn needs tailwind). The per-file `action` vocabulary is `create`, `merge`, `append`, `skip`, and `conflict`—a `conflict` means an existing file differs and a real run would prompt, so resolve it up front with `--on-conflict overwrite` or `--on-conflict skip`.

## 3. Apply

Two equivalent forms. Inline flags for a one-off:

```bash
unbranded --units core-editorconfig,opt-shadcn --pm pnpm --on-conflict skip --yes
```

Or a recipe file (`schemas/recipe.schema.json`) when you want the run reproducible:

```json
{
	"units": ["core-editorconfig", "opt-shadcn"],
	"pm": "pnpm",
	"onConflict": "skip",
	"postInstall": "none"
}
```

```bash
unbranded --config recipe.json
```

Exit 0 means applied; 1 means something failed (a bad recipe, a failed install). The run records its work in `.unbranded.json` and lays merge baselines into `.unbranded/baseline/`—commit both.

## 4. Verify

```bash
unbranded diff --json
```

```json
{ "schema": 1, "tracked": true, "drift": false, "files": [{ "path": ".editorconfig", "status": "unchanged" }] }
```

Exit 0 with `"drift": false` closes the loop. This is also your standing CI check: `diff` exits 1 the moment a tracked file drifts from what was recorded.

## 5. Day Two

The same non-interactive shapes keep working after the scaffold:

```bash
unbranded outdated --json            # grade the manifest pins against the registry
unbranded update --yes --strategy theirs   # pull newer templates; template wins conflicts
unbranded remove opt-shadcn --yes    # back a unit out; ref-counted, hash-checked
unbranded doctor --fix --yes         # audit and repair in one move
```

Two behaviors worth planning around. `update --yes` with a conflict and no `--strategy` exits 1 instead of guessing—pick `ours`, `theirs`, or `markers` before you automate it. And `remove` refuses to strand dependents: removing `core-tailwind` while `opt-shadcn` needs it errors with the list, and `--cascade` takes the whole chain out.

## Ground Rules

- Key off `schema` integers and exit codes, not output text. The human-facing strings will change without notice; the envelopes won't.
- Pass `--pm` explicitly in automation. Detection is lockfile-based and can want a prompt in ambiguous repos.
- The CLI never writes on a read verb: `list`, `diff`, `doctor` (without `--fix`), `outdated`, and `--dry-run` are guaranteed inert.
