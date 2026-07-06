import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { log } from '@clack/prompts';
import { runDiff } from './commands/diff';
import { runDoctor, runDoctorFix } from './commands/doctor';
import { runInit } from './commands/init';
import { runList } from './commands/list';
import { runOutdated } from './commands/outdated';
import { runRemove } from './commands/remove';
import { runUpdate } from './commands/update';
import { applyColorPolicy } from './util/color';
import { EXIT_ERROR, EXIT_OK } from './util/exit-codes';
import { nodeVersionError } from './util/node-version';
import { PKG_ROOT } from './util/paths';

// Gate before anything else: parseArgs and the rest assume a modern runtime, so
// bail with one line rather than letting a too-old Node fail cryptically later.
const NODE_FLOOR = 22;
const versionError = nodeVersionError(process.versions.node, NODE_FLOOR);
if (versionError) {
	process.stderr.write(`${versionError}\n`);
	process.exit(EXIT_ERROR);
}

const HELP = `Usage: unbranded [command] [options]

Commands:
  list                  Print the unit catalog; add --json for machine-readable output
  diff                  Compare tracked files against .unbranded.json; exits non-zero on drift
  doctor                Read-only repo audit; maps findings to fix-it units. --strict exits non-zero
                        Add --fix to install the units that close the fixable findings
  remove <unit>         Back a tracked unit out: delete its unmodified files, drop its sole-owned
                        package.json entries, and update .unbranded.json
  update                Pull newer templates into tracked files via three-way merge against the
                        recorded baselines; conflicts prompt per file (or use --strategy)
  outdated              Check every manifest pin against the npm registry; --strict exits non-zero
                        when majors are behind

Options:
  --config, -c <file>            Run non-interactively with a JSON recipe
  --target <dir>                 Scaffold against <dir> instead of the current directory
  --units <a,b,c>                Comma-separated unit ids (recipe field: units)
  --pm <npm|pnpm|yarn|bun>       Package manager (recipe field: pm); skips detection, including the workspace-leaf refusal
  --on-conflict <overwrite|skip> How to treat existing files (recipe field: onConflict)
  --post-install <all|none>      Run post-install steps or skip them (recipe field: postInstall)
  --yes                          Apply without the confirmation prompt; needs --units (or --config)
  --force                        Skip the dirty-tree guard even if the target repo has uncommitted changes (recipe field: force)
  --latest                       Install the latest dependency versions, not the pinned defaults (recipe field: versions)
  --dry-run                      Report what each file would do, then exit without writing or installing
  --diff                         With --dry-run (or \`diff\`), print the unified patch for every changed file
  --json                         With \`list\`, \`diff\`, or \`doctor\`, emit machine-readable output
  --strict                       With \`doctor\`, exit non-zero when the audit finds anything
  --fix                          With \`doctor\`, hand the fixable findings to the apply pipeline (no --json; composes with --yes, --dry-run, --pm)
  --cascade                      With \`remove\`, also remove the units that depend on the target
  --strategy <ours|theirs|markers>  With \`update\`, answer every conflict the same way (required for --yes runs that hit one)
  --registry <url>               With \`outdated\`, check against this registry instead of npmjs (or set npm_config_registry)
  --no-color                     Disable ANSI color everywhere (also honors the NO_COLOR env var)
  --color                        Force ANSI color even when output is piped
  --help, -h                     Show this help
  --version, -v                  Show the version

Inline flags override the matching --config field per field, the same way --latest beats a recipe's versions.

Examples:
  unbranded                                            # interactive prompt flow
  unbranded list                                       # print the unit catalog
  unbranded list --json                                # machine-readable catalog for tooling
  unbranded diff                                       # report drift of tracked files vs. the recorded state
  unbranded diff --json                                # CI drift check: non-zero exit when files have drifted
  unbranded doctor                                     # audit the current repo and map gaps to fix-it units
  unbranded doctor --strict --json                     # repo-hygiene CI gate: non-zero exit on any finding
  unbranded doctor --fix --yes                         # audit, then install every fixable finding's unit
  unbranded remove opt-husky --dry-run                 # preview backing a unit out, change nothing
  unbranded update --dry-run --diff                    # preview template updates with patches
  unbranded update --yes --strategy theirs             # CI-safe update, template wins conflicts
  unbranded outdated --strict                          # freshness gate: non-zero exit on major-behind pins
  unbranded --config recipe.json                       # reproducible, scriptable run
  unbranded --units core-eslint,core-vitest --pm pnpm --yes   # fully non-interactive, no recipe file
  unbranded --latest                                   # take the newest versions, not the pins
  unbranded --dry-run --diff                           # preview every change, including diffs, write nothing
`;

const { values, positionals } = parseArgs({
	options: {
		'config': { type: 'string', short: 'c' },
		'target': { type: 'string' },
		'units': { type: 'string' },
		'pm': { type: 'string' },
		'on-conflict': { type: 'string' },
		'post-install': { type: 'string' },
		'yes': { type: 'boolean' },
		'force': { type: 'boolean' },
		'latest': { type: 'boolean' },
		'dry-run': { type: 'boolean' },
		'diff': { type: 'boolean' },
		'json': { type: 'boolean' },
		'strict': { type: 'boolean' },
		'fix': { type: 'boolean' },
		'cascade': { type: 'boolean' },
		'strategy': { type: 'string' },
		'registry': { type: 'string' },
		'no-color': { type: 'boolean' },
		'color': { type: 'boolean' },
		'help': { type: 'boolean', short: 'h' },
		'version': { type: 'boolean', short: 'v' },
	},
	// Positionals carry the subcommand (e.g. `unbranded list`). Bare `unbranded`
	// with no positional still routes to the interactive init below.
	allowPositionals: true,
});

// Settle the color policy before anything writes. clack and the picker color via
// node's styleText, which reads NO_COLOR/FORCE_COLOR live but ignores the
// --no-color/--color flags on their own, so this bridges the flags into the env
// those calls do read.
applyColorPolicy();

if (values.help) {
	process.stdout.write(HELP);
	process.exit(EXIT_OK);
}

if (values.version) {
	// Read at runtime so the version stays in sync with package.json without
	// rebuilding. The cost is one filesystem read per invocation.
	const pkg = JSON.parse(readFileSync(join(PKG_ROOT, 'package.json'), 'utf-8')) as { version: string };
	process.stdout.write(`${pkg.version}\n`);
	process.exit(EXIT_OK);
}

const command = positionals[0];

// `list` needs no target project and no TTY, so it runs and exits before any
// of the init flow's detection kicks in.
if (command === 'list') {
	runList({ json: values.json });
	process.exit(EXIT_OK);
}

// Read-only drift check against .unbranded.json. No target, no TTY; exit code
// carries the verdict (non-zero on drift) so CI can gate on it directly.
if (command === 'diff') {
	process.exit(runDiff({ json: values.json, diff: values.diff }));
}

// Read-only repo audit: guaranteed zero writes, cwd only. Default exit is 0 so a
// report never fails a job; --strict turns findings into a non-zero exit.
// --fix crosses into the apply pipeline (writes!), so it refuses --json rather
// than guess whether the caller wanted the audit report or the repair.
if (command === 'doctor') {
	if (values.fix) {
		if (values.json) {
			process.stderr.write('doctor --fix has no --json output. Run the audit with `doctor --json`, or drop --json to apply fixes.\n');
			process.exit(EXIT_ERROR);
		}
		process.exit(await runDoctorFix({
			yes: values.yes,
			dryRun: values['dry-run'],
			diff: values.diff,
			force: values.force,
			pm: values.pm,
		}).catch((err: unknown) => {
			log.error(err instanceof Error ? err.message : String(err));
			return 1;
		}));
	}
	process.exit(runDoctor({ json: values.json, strict: values.strict }));
}

// Backing a unit out is an apply-shaped verb (it writes), so it reuses the same
// composable flags: --yes, --dry-run, --force, plus its own --cascade.
if (command === 'remove') {
	const unitId = positionals[1];
	if (unitId === undefined) {
		process.stderr.write('Usage: unbranded remove <unit-id>. Run `unbranded list` for the ids.\n');
		process.exit(EXIT_ERROR);
	}
	process.exit(await runRemove(unitId, {
		yes: values.yes,
		dryRun: values['dry-run'],
		force: values.force,
		cascade: values.cascade,
	}).catch((err: unknown) => {
		log.error(err instanceof Error ? err.message : String(err));
		return EXIT_ERROR;
	}));
}

// Read-only freshness report: manifest pins vs the registry's latest. Like
// doctor, the default exit is 0 so a report never fails a job; --strict is the
// opt-in gate, and it trips on majors only.
if (command === 'outdated') {
	process.exit(await runOutdated({
		json: values.json,
		strict: values.strict,
		registry: values.registry,
	}).catch((err: unknown) => {
		log.error(err instanceof Error ? err.message : String(err));
		return EXIT_ERROR;
	}));
}

// Template refresh over the recorded baselines. Validating --strategy here keeps
// a typo'd value a one-line error instead of a half-applied update.
if (command === 'update') {
	const strategy = values.strategy;
	if (strategy !== undefined && strategy !== 'ours' && strategy !== 'theirs' && strategy !== 'markers') {
		process.stderr.write(`--strategy must be ours, theirs, or markers (got "${strategy}").\n`);
		process.exit(EXIT_ERROR);
	}
	process.exit(await runUpdate({
		yes: values.yes,
		dryRun: values['dry-run'],
		diff: values.diff,
		force: values.force,
		strategy,
	}).catch((err: unknown) => {
		log.error(err instanceof Error ? err.message : String(err));
		return EXIT_ERROR;
	}));
}

// A stray positional is almost always a typo (`unbranded lst`). Failing loudly
// beats silently dropping it and running the interactive flow the user didn't ask for.
if (command !== undefined) {
	process.stderr.write(`Unknown command: ${command}. Run \`unbranded --help\` for usage.\n`);
	process.exit(EXIT_ERROR);
}

runInit({
	configPath: values.config,
	// Resolve against the invocation cwd now, before any detection runs, so the
	// dir is stable even though a relative --config path is still read from here.
	targetDir: values.target ? resolve(values.target) : undefined,
	latest: values.latest,
	force: values.force,
	dryRun: values['dry-run'],
	diff: values.diff,
	inline: {
		units: values.units,
		pm: values.pm,
		onConflict: values['on-conflict'],
		postInstall: values['post-install'],
		yes: values.yes,
	},
}).catch((err: unknown) => {
	// Top-level catch so an exception surfaces as a friendly clack error
	// instead of a raw stack trace. detectPm throws for workspace-leaf and
	// malformed package.json; config validation throws for bad recipes.
	log.error(err instanceof Error ? err.message : String(err));
	process.exit(EXIT_ERROR);
});
