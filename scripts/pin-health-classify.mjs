// Names the outcome of a pin-health agent run from what it left in the working tree, so the workflow can tell a hold apart from a repair before deciding what to validate and which base to publish on. Design: .github/control-loops/pin-health.md.
//
//   node scripts/pin-health-classify.mjs
//
// Prints repair, hold, or escalate, and writes `outcome=` to GITHUB_OUTPUT when that's set. Run it after the scope guard and before anything commits: it reads uncommitted changes against HEAD, which is still the target branch's head at that point.

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import process from 'node:process';
import { parsePorcelain } from './pin-health-scope-guard.mjs';

export const MEMORY_PATH = '.github/agent-memory/pin-health.md';

// The classification runs against the target branch's head, so a bump branch's own commits never count, only what the agent changed. A hold changes the memory file and nothing else.
export function classifyChange(entries) {
	if (entries.length === 0) return 'escalate';
	return entries.every((e) => e.path === MEMORY_PATH) ? 'hold' : 'repair';
}

function main() {
	const raw = execFileSync('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], {
		encoding: 'utf-8',
	});
	const outcome = classifyChange(parsePorcelain(raw));
	process.stdout.write(`${outcome}\n`);
	if (process.env.GITHUB_OUTPUT)
		writeFileSync(process.env.GITHUB_OUTPUT, `outcome=${outcome}\n`, { flag: 'a' });
}

if (process.argv[1]?.endsWith('pin-health-classify.mjs')) main();
