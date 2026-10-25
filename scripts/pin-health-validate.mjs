// The pin-health loop's validation bar, in one place. The agent runs it before it finishes, and the workflow runs it again before committing, so a PR never rests on the agent's word that the checks passed.
//
//   node scripts/pin-health-validate.mjs repro   # only the agent's reproduction of the failing CI job
//   node scripts/pin-health-validate.mjs all     # the repo gate (install, typecheck, lint, test, build), then the reproduction
//
// The reproduction comes from a JSON file the agent writes (default /tmp/pin-health/repro.json, or PIN_HEALTH_REPRO): { "spec": "test/e2e/<file>.spec.ts", "env": { "UB_PRESET": "next-app" } }. The agent's allowlist has no way to set env vars or run arbitrary commands, so this file is how it runs one e2e spec the way a CI job does. That's why the spec path and env keys are checked so tightly.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import process from 'node:process';

// The install comes first because a bump can break it (PR #235 review), and a repair has to leave the tree installable from its lockfile.
export const GATE = [
	['pnpm', ['install', '--frozen-lockfile']],
	['pnpm', ['typecheck']],
	['pnpm', ['lint'], { CI: 'true' }],
	['pnpm', ['test']],
	['pnpm', ['build']],
];

const SPEC_PATH = /^test\/e2e\/[\w-]+\.spec\.ts$/;
const ENV_KEY = /^UB_[A-Z0-9_]+$/;
const ENV_VALUE = /^[\w.-]+$/;

// Throws on anything that isn't one e2e spec plus UB_* selectors, the only shape ci.yml's e2e jobs take.
export function parseRepro(raw) {
	const repro = JSON.parse(raw);
	if (typeof repro.spec !== 'string' || !SPEC_PATH.test(repro.spec)) {
		throw new Error(`repro.spec must match ${SPEC_PATH}, got ${JSON.stringify(repro.spec)}`);
	}
	const env = repro.env ?? {};
	for (const [key, value] of Object.entries(env)) {
		if (!ENV_KEY.test(key) || typeof value !== 'string' || !ENV_VALUE.test(value)) {
			throw new Error(`repro.env entries must be UB_*=<word>, got ${key}=${JSON.stringify(value)}`);
		}
	}
	return { spec: repro.spec, env };
}

export function reproCommand({ spec, env }) {
	return ['pnpm', ['vitest', 'run', '--config', 'vitest.e2e.config.ts', spec], env];
}

function run([cmd, args, env = {}]) {
	const label = `${Object.entries(env)
		.map(([k, v]) => `${k}=${v} `)
		.join('')}${cmd} ${args.join(' ')}`;
	process.stdout.write(`\n▶ ${label}\n`);
	const { status } = spawnSync(cmd, args, { stdio: 'inherit', env: { ...process.env, ...env } });
	return { label, ok: status === 0 };
}

function main() {
	const mode = process.argv[2];
	if (mode !== 'repro' && mode !== 'all') {
		process.stderr.write('Usage: node scripts/pin-health-validate.mjs <repro|all>\n');
		process.exit(1);
	}
	const reproPath = process.env.PIN_HEALTH_REPRO ?? '/tmp/pin-health/repro.json';
	const steps = mode === 'all' ? [...GATE] : [];

	if (existsSync(reproPath)) {
		// e2e specs run the built CLI, so the reproduction always rebuilds first, even when the gate already did.
		if (mode === 'repro') steps.push(['pnpm', ['build']]);
		steps.push(reproCommand(parseRepro(readFileSync(reproPath, 'utf-8'))));
	} else if (mode === 'repro') {
		process.stderr.write(`No reproduction at ${reproPath}; write it first.\n`);
		process.exit(1);
	} else {
		process.stdout.write(`No reproduction at ${reproPath}; running the gate only.\n`);
	}

	const results = [];
	for (const step of steps) {
		const result = run(step);
		results.push(result);
		if (!result.ok) break;
	}
	process.stdout.write(
		`\npin-health validation:\n${results.map((r) => `  ${r.ok ? 'PASS' : 'FAIL'} ${r.label}`).join('\n')}\n`,
	);
	if (results.some((r) => !r.ok)) process.exit(1);
}

if (process.argv[1]?.endsWith('pin-health-validate.mjs')) main();
