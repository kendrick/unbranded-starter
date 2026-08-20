# Authoring Units

A unit is one installable piece of tooling: the files it writes, the dependencies it pins, and the rules about what has to travel with it. The fifteen built-in units are written against the same contract your own units use. That contract ships as `schemas/unit.schema.json`. Every definition carries an integer `schema` field that names the version it targets, so tooling keys off that number instead of sniffing fields.

This page covers writing a definition and checking it with `unbranded validate`. The contract summary for every other JSON surface lives in [AGENTS.md](../AGENTS.md).

## 1. The Shape on Disk

A unit is a directory holding a `unit.json` and the templates it copies:

```
my-units/
	banner/
		unit.json
		BANNER.txt
	license-header/
		unit.json
```

`validate` accepts three shapes, and tells them apart by what it finds rather than by a flag:

| You pass                          | It reads                                                |
| --------------------------------- | ------------------------------------------------------- |
| A `.json` file                    | One definition, with templates resolved beside the file |
| A directory holding a `unit.json` | One unit                                                |
| A directory of those directories  | Every child that holds a `unit.json`                    |

`validate` ignores a child without a `unit.json`, so a `README.md` or a `.git` beside your units costs you nothing.

## 2. A Minimal Definition

Six fields are required. Everything else is optional.

```json
{
	"schema": 1,
	"id": "banner",
	"category": "foundation",
	"label": "Repo banner",
	"description": "Drops a BANNER.txt at the repo root.",
	"files": [
		{ "src": "BANNER.txt", "dest": "BANNER.txt" }
	]
}
```

`id` is lowercase letters, digits, and hyphens. It has to be unique across the directory, and it may not take an id a built-in already uses. A shadowed built-in would quietly change what a recipe resolves to.

`category` is one of `foundation`, `lint`, `style`, `types`, `test`, `e2e`, `monorepo`, `ui`, `git`, `editor`, or `ci`. The category decides where the unit appears in `unbranded list` and in the interactive picker.

`files` may be empty. A unit that only pins dependencies or only patches `package.json` is legitimate, and three of the built-ins ship no files at all.

## 3. Files

Every file entry needs a `dest` and exactly one of `src` or `content`.

Use `src` for a template that lives beside the definition. The path resolves relative to the unit's own directory, and it must stay inside that directory. That rule is what lets one definition move between a local directory and a published pack without rewriting a path.

Use `content` when the payload is short enough to inline:

```json
{
	"files": [
		{ "src": "BANNER.txt", "dest": "BANNER.txt" },
		{ "content": "node_modules\n", "dest": ".gitignore", "mode": "append-if-missing" }
	]
}
```

`dest` is relative to the target project root and understands `{projectName}`. `mode` is `copy` (the default), `merge-json`, or `append-if-missing`. Set `rename` when the shipped filename can't match the destination. The built-ins need it because npm strips a top-level `.gitignore` out of tarballs.

## 4. Dependencies

Pin exact versions:

```json
{
	"devDependencies": { "prettier": "3.4.2" }
}
```

`validate` rejects a range. Two runs of the same unit have to produce the same tree, and recipes and packs rest on that guarantee.

## 5. Validate

```bash
unbranded validate my-units
```

Every issue names the path that carries it, what was expected, and what it found. Fix them and run the command again.

`validate` writes nothing and reads only the definitions you point it at, so it is safe to run from a publish gate:

```bash
unbranded validate my-units --json
```

The report envelope is `schemas/validate.schema.json`. The command exits 0 when every definition is valid and 1 when any is not.

## 6. Versioning

Set `schema` to the version you wrote against. `unbranded` states the range it understands. It answers anything newer with an upgrade prompt rather than a parse error, because a unit from a newer publisher is not a mistake you can edit your way out of.

The integer bumps only on a breaking shape change. A new optional field does not move it.

## Field Reference

| Field                   | Required | Notes                                                                                                                                                           |
| ----------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schema`                | yes      | Integer. The contract version this definition targets.                                                                                                          |
| `id`                    | yes      | `^[a-z0-9][a-z0-9-]*$`. Unique, and not a built-in's id.                                                                                                        |
| `category`              | yes      | One of the eleven listed above.                                                                                                                                 |
| `label`                 | yes      | Shown in the picker and in `list`.                                                                                                                              |
| `description`           | yes      | One line, shown beside the label.                                                                                                                               |
| `files`                 | yes      | May be empty. Each entry takes a `dest` plus exactly one of `src` or `content`.                                                                                 |
| `dependencies`          | no       | Exact pins only.                                                                                                                                                |
| `devDependencies`       | no       | Exact pins only.                                                                                                                                                |
| `options`               | no       | Variant axes. Each needs a `key` unique across all units and a `default` matching one of its `choices`. A choice may carry its own `files` and dependency maps. |
| `implies`               | no       | Select these units too.                                                                                                                                         |
| `requires`              | no       | Hard precondition. An error when any is missing.                                                                                                                |
| `excludes`              | no       | Symmetric conflict. Either side blocks the other.                                                                                                               |
| `postInstall`           | no       | Commands run through the detected package manager, each behind a prompt.                                                                                        |
| `packageJsonPatch`      | no       | `scripts`, `engines`, `packageManager`.                                                                                                                         |
| `recommendedExtensions` | no       | VS Code marketplace ids, gathered across the selected units.                                                                                                    |
| `removeNotes`           | no       | Printed by `unbranded remove`. Guidance only; nothing runs.                                                                                                     |

## Ground Rules

- Pin dependencies exactly. A range breaks reproducibility, and `validate` rejects it.
- Keep every `src` inside the unit's own directory. `validate` rejects an absolute path or a `..` segment.
- Never reuse a built-in's id.
- Point relations at ids that exist, whether built-in or a sibling in the same directory.
- Templates are inert data. A unit copies them and never executes them. Only `postInstall` runs anything, and every step prompts first.
