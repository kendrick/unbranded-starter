import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { log } from '@clack/prompts';
import { runInit } from './commands/init';
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

const HELP = `Usage: unbranded [options]

Options:
  --config, -c <file>   Run non-interactively with a JSON recipe
  --help, -h            Show this help
  --version, -v         Show the version

Examples:
  unbranded                          # interactive prompt flow
  unbranded --config recipe.json     # reproducible, scriptable run
`;

const { values } = parseArgs({
	options: {
		config: { type: 'string', short: 'c' },
		help: { type: 'boolean', short: 'h' },
		version: { type: 'boolean', short: 'v' },
	},
	allowPositionals: false,
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

runInit({ configPath: values.config }).catch((err: unknown) => {
	// Top-level catch so an exception surfaces as a friendly clack error
	// instead of a raw stack trace. detectPm throws for workspace-leaf and
	// malformed package.json; config validation throws for bad recipes.
	log.error(err instanceof Error ? err.message : String(err));
	process.exit(1);
});
