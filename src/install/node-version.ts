import type { Pm } from '../detect/pm';
import { spawn } from 'node:child_process';
import { spawnOptions } from './spawn';

// The one unit whose output can't be a shipped template: .nvmrc, engines.node,
// and the Corepack packageManager field all have to reflect the environment the
// user is actually running, not whatever the CLI author pinned at publish time.
// run.ts recognizes this id and materializes the unit from computeNodeVersion.
export const NODE_VERSION_UNIT_ID = 'core-node-version';

export interface NodeVersionInput {
	// e.g. process.versions.node — '24.13.0'.
	nodeVersion: string;
	pm: Pm | null;
	// The pm's real reported version, or null when detection or the query failed.
	pmVersion: string | null;
}

export interface NodeVersionPins {
	nvmrc: string;
	engines: Record<string, string>;
	packageManager?: string;
}

// Derive every node/pm pin from a single source so .nvmrc and engines can never
// disagree. packageManager is omitted unless we have a genuine pm@version —
// Corepack treats the field as authoritative, so a fabricated pin is worse than
// none.
export function computeNodeVersion(input: NodeVersionInput): NodeVersionPins {
	const major = input.nodeVersion.split('.')[0] ?? input.nodeVersion;
	const pins: NodeVersionPins = {
		nvmrc: `${major}\n`,
		engines: { node: `>=${major}` },
	};
	if (input.pm && input.pmVersion)
		pins.packageManager = `${input.pm}@${input.pmVersion}`;
	return pins;
}

// Ask the running package manager its own version. Returns null on any failure
// (binary missing, non-zero exit, empty output) so the caller falls back to
// omitting packageManager rather than pinning a guess.
export function queryPmVersion(pm: Pm | null, cwd: string): Promise<string | null> {
	if (!pm)
		return Promise.resolve(null);
	return new Promise((resolve) => {
		// spawnOptions carries the win32 shell:true that lets .cmd shims run, but
		// its stdio:'inherit' would send the version to the terminal instead of a
		// buffer — override to pipe so we can capture it.
		const child = spawn(pm, ['--version'], { ...spawnOptions(cwd), stdio: ['ignore', 'pipe', 'ignore'] });
		let out = '';
		child.stdout?.on('data', (chunk: Buffer) => {
			out += chunk.toString('utf-8');
		});
		child.on('error', () => resolve(null));
		child.on('exit', code => resolve(code === 0 && out.trim() ? out.trim() : null));
	});
}
