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

## 7. Using Your Units

Once your definitions validate, install them alongside the built-ins by naming their directory on the command line or in a recipe.

### The Command Line

```bash
unbranded --units-dir ./my-units
```

The flag resolves the directory against the current working directory, loads every valid unit in it, and offers them in the picker beside the built-ins.

The directory's basename becomes the namespace. Units in `./my-units` are referenced as `my-units/<id>`, so a definition declaring `"id": "banner"` installs as `my-units/banner`:

```bash
unbranded --units-dir ./my-units --units my-units/banner --yes
```

Name the qualified id. A bare `banner` matches nothing in the catalog and fails as an unknown id.

The directory name has to match the pattern unit ids do, `^[a-z0-9][a-z0-9-]*$`, because it becomes half of every qualified reference. `my-units` works; `My Units` does not.

### In a Recipe

A recipe carries the same path in a `unitsDir` field:

```json
{
	"units": ["my-units/banner", "core-eslint"],
	"unitsDir": "./my-units",
	"pm": "pnpm",
	"onConflict": "overwrite",
	"postInstall": "all"
}
```

Under `unbranded --config recipe.json`, `./my-units` resolves against the recipe file's own directory rather than the current working directory. A recipe and the units it names travel together, so the path has to mean the same thing wherever someone runs it from.

Pass `--units-dir` alongside a recipe and the flag wins.

### References Inside a Unit

`implies`, `requires`, and `excludes` take bare ids, exactly as they do in a built-in:

```json
{
	"id": "banner",
	"implies": ["license-header", "core-eslint"],
	"excludes": ["markdown-lint"]
}
```

The loader resolves each one against the unit's own directory first, then the built-in catalog. So `banner` implying `license-header` finds `my-units/license-header` when that sibling exists, and a built-in of that name otherwise. It is the order an import takes when it prefers a local module over an installed package.

You never write a namespace inside a definition. The loader attaches it, and that is what keeps a unit directory portable: rename the directory and every reference inside it still resolves.

### Shadowing a Built-in

A local unit may declare a built-in's id. `my-units/core-eslint` and `core-eslint` are different units, and a sibling implying `core-eslint` gets the local one. `unbranded` warns when it loads a directory holding such a unit, because reusing a familiar name usually means the author wanted to replace the built-in rather than sit beside it.

### Invalid Definitions

`unbranded` skips a definition that fails validation, names it and the reason, and installs the rest of the directory. One half-written unit doesn't block the ones beside it. Run `unbranded validate ./my-units` to see the same errors on their own.

### Day-2 Commands

`diff`, `remove`, and `update` read the directory's path back out of `.unbranded.json`, where the scaffold recorded it, so they need no flag:

```bash
unbranded diff
unbranded remove my-units/banner
unbranded update
```

Pass `--units-dir` to one of those only when the directory has moved:

```bash
unbranded diff --units-dir ./new-location
```

### When the Directory Is Missing

A recipe that names local units but no `unitsDir` fails before anything is written. The error names the ids it could not resolve and points at `--units-dir`. A `unitsDir` pointing at a directory that isn't there fails the same way, naming the path instead.

The day-2 commands degrade instead of failing. `diff`, `remove`, and `update` warn about the directory they could not read and carry on with what they can still judge, so a directory you deleted never locks you out of removing what it installed.

## Ground Rules

- Pin dependencies exactly. A range breaks reproducibility, and `validate` rejects it.
- Keep every `src` inside the unit's own directory. `validate` rejects an absolute path or a `..` segment.
- Reusing a built-in's id is legal, since the namespace keeps the two apart, but it warns and it usually means you meant to override the built-in instead.
- Point relations at ids that exist, whether built-in or a sibling in the same directory. Write them bare; the loader attaches the namespace.
- Templates are inert data. A unit copies them and never executes them. Only `postInstall` runs anything, and every step prompts first.
- Name a units directory the way you'd name a unit, `^[a-z0-9][a-z0-9-]*$`, because that name becomes half of every reference to what's inside it.
