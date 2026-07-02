import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { log } from '@clack/prompts';
import { runInit } from './commands/init';
import { runList } from './commands/list';
import { nodeVersionError } from './util/node-version';
import { PKG_ROOT } from './util/paths';

// Gate before anything else: parseArgs and the rest assume a modern runtime, so
// bail with one line rather than letting a too-old Node fail cryptically later.
const NODE_FLOOR = 22;
const versionError = nodeVersionError(process.versions.node, NODE_FLOOR);
if (versionError) {
	process.stderr.write(`${versionError}\n`);
	process.exit(1);
}

const HELP = `Usage: unbranded [command] [options]

Commands:
  list                  Print the unit catalog; add --json for machine-readable output

Options:
  --config, -c <file>            Run non-interactively with a JSON recipe
  --units <a,b,c>                Comma-separated unit ids (recipe field: units)
  --pm <npm|pnpm|yarn|bun>       Package manager (recipe field: pm); also skips the prompt in interactive runs
  --on-conflict <overwrite|skip> How to treat existing files (recipe field: onConflict)
  --post-install <all|none>      Run post-install steps or skip them (recipe field: postInstall)
  --yes                          Apply without the confirmation prompt; needs --units (or --config)
  --latest                       Install the latest dependency versions, not the pinned defaults (recipe field: versions)
  --json                         With \`list\`, emit the catalog as JSON
  --help, -h                     Show this help
  --version, -v                  Show the version

Inline flags override the matching --config field per field, the same way --latest beats a recipe's versions.

Examples:
  unbranded                                            # interactive prompt flow
  unbranded list                                       # print the unit catalog
  unbranded list --json                                # machine-readable catalog for tooling
  unbranded --config recipe.json                       # reproducible, scriptable run
  unbranded --units core-eslint,core-vitest --pm pnpm --yes   # fully non-interactive, no recipe file
  unbranded --latest                                   # take the newest versions, not the pins
`;

const { values, positionals } = parseArgs({
	options: {
		'config': { type: 'string', short: 'c' },
		'units': { type: 'string' },
		'pm': { type: 'string' },
		'on-conflict': { type: 'string' },
		'post-install': { type: 'string' },
		'yes': { type: 'boolean' },
		'latest': { type: 'boolean' },
		'json': { type: 'boolean' },
		'help': { type: 'boolean', short: 'h' },
		'version': { type: 'boolean', short: 'v' },
	},
	// Positionals carry the subcommand (e.g. `unbranded list`). Bare `unbranded`
	// with no positional still routes to the interactive init below.
	allowPositionals: true,
});

if (values.help) {
	process.stdout.write(HELP);
	process.exit(0);
}

if (values.version) {
	// Read at runtime so the version stays in sync with package.json without
	// rebuilding. The cost is one filesystem read per invocation.
	const pkg = JSON.parse(readFileSync(join(PKG_ROOT, 'package.json'), 'utf-8')) as { version: string };
	process.stdout.write(`${pkg.version}\n`);
	process.exit(0);
}

const command = positionals[0];

// `list` needs no target project and no TTY, so it runs and exits before any
// of the init flow's detection kicks in.
if (command === 'list') {
	runList({ json: values.json });
	process.exit(0);
}

// A stray positional is almost always a typo (`unbranded lst`). Failing loudly
// beats silently dropping it and running the interactive flow the user didn't ask for.
if (command !== undefined) {
	process.stderr.write(`Unknown command: ${command}. Run \`unbranded --help\` for usage.\n`);
	process.exit(1);
}

runInit({
	configPath: values.config,
	latest: values.latest,
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
	process.exit(1);
});
