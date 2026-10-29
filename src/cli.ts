import { EXIT_ERROR } from './util/exit-codes';
import { nodeVersionError } from './util/node-version';

// Keep every static import here clear of util.styleText, which Node added in 20.12 and which @clack/core and the unit picker import. ESM links all static imports before any module body runs, so on an older Node the link throws a SyntaxError before this check can print its line.
const NODE_FLOOR = 22;
const versionError = nodeVersionError(process.versions.node, NODE_FLOOR);
if (versionError) {
	process.stderr.write(`${versionError}\n`);
	process.exit(EXIT_ERROR);
}

const { main } = await import('./main.js');
await main();
