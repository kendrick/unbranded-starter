import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

// The manifest filename a unit directory is recognized by. Also the marker that
// separates "one unit" from "a directory of units" during path dispatch.
export const MANIFEST = 'unit.json';

export interface Candidate {
	// Absolute path to the definition document, for reading.
	file: string;
	// Where this unit's `src` paths resolve from. For a lone .json that is the
	// file's own directory, so a definition can sit beside its templates.
	baseDir: string;
}

// Three shapes, distinguished by what is on disk rather than by a flag: a lone
// .json is one definition, a directory with a unit.json is one unit, and anything
// else is treated as a directory of unit directories. `validate` and the
// --units-dir loader both walk this, so a path that validates clean is the same
// path that loads.
export function discover(target: string): Candidate[] | { error: string } {
	const abs = resolve(target);
	if (!existsSync(abs))
		return { error: `${target}: no such file or directory.` };

	if (!statSync(abs).isDirectory()) {
		if (!abs.endsWith('.json'))
			return { error: `${target}: expected a .json unit definition or a directory.` };
		return [{ file: abs, baseDir: dirname(abs) }];
	}

	const own = join(abs, MANIFEST);
	if (existsSync(own))
		return [{ file: own, baseDir: abs }];

	const children = readdirSync(abs, { withFileTypes: true })
		.filter(e => e.isDirectory())
		.map(e => join(abs, e.name, MANIFEST))
		.filter(file => existsSync(file))
		.sort();

	if (children.length === 0)
		return { error: `${target}: no ${MANIFEST} here or in any immediate subdirectory.` };

	return children.map(file => ({ file, baseDir: dirname(file) }));
}
