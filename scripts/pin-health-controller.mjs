// The pin-health loop's controller: picks the one red bump PR (or the main-branch drift behind it) that this run's agent works on. Design: .github/control-loops/pin-health.md.
//
//   node scripts/pin-health-controller.mjs [--out /tmp/pin-health/target.json] [--logs /tmp/pin-health/logs]
//     [--memory .github/agent-memory/pin-health.md] [--outdated /tmp/pin-health/outdated.json] [--no-rerun] [--pr <number> [--sha <sha>]]
//
// Reads PRs and CI runs through `gh` (reads only, unless re-running jobs), writes one target object, and downloads the failing jobs' logs so the agent can read them without a GitHub token. Locally, pass --no-rerun: re-running a job is a write. The pure pieces are exported for the spec; main() is gh glue.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import process from 'node:process';

export const LOOP_LABEL = 'agent-pin-health';
export const ESCALATION_MARKER = 'agent-pin-health:escalated';
const BUMP_PREFIX = 'bump/';
// Each re-run waits out a CI run, so the number of candidates tried per run is capped to keep the job inside its timeout.
const MAX_RERUNS = 3;
const LOG_TAIL_LINES = 500;
// vitest colors its output even in CI, and the escape codes are noise to an agent reading the log as text.
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

const majorOf = (version) => Number(/^(\d+)\./.exec(version)?.[1]);

// Held pins live under a `## Held pins` heading in the memory file, one per bullet: - `name` held at <major> (unit): reason
export function parseHeldPins(memory) {
	const held = [];
	let inSection = false;
	for (const line of memory.split('\n')) {
		if (/^##\s/.test(line)) inSection = /^##\s+held pins\s*$/i.test(line);
		if (!inSection) continue;
		const match = /^-\s+`([^`]+)`\s+held at\s+(\d+)\b/.exec(line);
		if (match) held.push({ name: match[1], major: Number(match[2]) });
	}
	return held;
}

// bump-pins.mjs writes one `- name from → to` line per pin into the PR body.
export function parseBumpLines(body) {
	const bumps = [];
	for (const line of (body ?? '').split('\n')) {
		const match = /^-\s+(\S+)\s+(\S+)\s+→\s+(\S+)\s*$/.exec(line);
		if (match) bumps.push({ name: match[1], from: match[2], to: match[3] });
	}
	return bumps;
}

// A PR whose every bump crosses a held major is a hold you already decided on. It stays red until you close it, and the agent has nothing new to say about it.
export function isFullyHeld(bumps, held) {
	if (bumps.length === 0) return false;
	return bumps.every((b) => held.some((h) => h.name === b.name && majorOf(b.to) > h.major));
}

// An escalation is tied to the head SHA it looked at. bump-pins force-pushes every week, so a new SHA that's still red earns a fresh look.
export function hasEscalation(comments, sha) {
	return (comments ?? []).some((c) =>
		(c.body ?? '').includes(`<!-- ${ESCALATION_MARKER} sha=${sha} -->`),
	);
}

export function sharedFailures(prJobs, mainJobs) {
	const onMain = new Set(mainJobs.map((j) => j.name));
	return prJobs.filter((j) => onMain.has(j.name));
}

// Red bump PRs worth a look, oldest first.
export function rankCandidates({ prs, held }) {
	const loopHeads = new Set(
		prs.filter((p) => p.labels.some((l) => l.name === LOOP_LABEL)).map((p) => p.headRefName),
	);
	const skipped = [];
	const candidates = [];
	for (const pr of prs) {
		if (!pr.headRefName.startsWith(BUMP_PREFIX)) continue;
		const unit = pr.headRefName.slice(BUMP_PREFIX.length);
		const bumps = parseBumpLines(pr.body);
		if (loopHeads.has(`pin-health/${unit}`))
			skipped.push(`#${pr.number}: pin-health/${unit} already open`);
		else if (isFullyHeld(bumps, held)) skipped.push(`#${pr.number}: every bump is held in memory`);
		else if (hasEscalation(pr.comments, pr.headRefOid))
			skipped.push(`#${pr.number}: already escalated at ${pr.headRefOid.slice(0, 7)}`);
		else candidates.push({ ...pr, unit, bumps });
	}
	candidates.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
	return { candidates, skipped };
}

// The loop itself, with every GitHub call injected so the spec can drive it. Returns the target object the actuator reads.
export async function chooseTarget({
	prs,
	held,
	ciRun,
	mainRun,
	rerunAndWait,
	maxReruns = MAX_RERUNS,
}) {
	const { candidates, skipped } = rankCandidates({ prs, held });
	let reruns = 0;
	for (const pr of candidates) {
		let run = await ciRun(pr.headRefOid);
		if (!run || run.conclusion !== 'failure') continue;
		if (rerunAndWait) {
			if (reruns >= maxReruns) {
				skipped.push(`#${pr.number}: re-run cap reached this run`);
				continue;
			}
			reruns += 1;
			run = await rerunAndWait(run.id);
			if (run.conclusion !== 'failure') {
				skipped.push(`#${pr.number}: went green on re-run (flake)`);
				continue;
			}
		}

		// A run can fail before any job starts (a startup failure), or outlive its job records. With no failing job there's no log to read and nothing to reproduce.
		if (run.failedJobs.length === 0) {
			skipped.push(`#${pr.number}: CI failed without a failing job`);
			continue;
		}

		const main = await mainRun();
		const shared =
			main?.conclusion === 'failure' ? sharedFailures(run.failedJobs, main.failedJobs) : [];
		if (shared.length > 0) {
			return {
				target: 'main-drift',
				reason: `#${pr.number} fails ${shared.map((j) => j.name).join(', ')}, and main's latest CI run fails the same job, so the bump didn't cause it`,
				pr: pick(pr),
				unit: pr.unit,
				bumps: pr.bumps,
				branch: 'pin-health/main-drift',
				baseRef: 'main',
				run: {
					id: main.id,
					failedJobs: main.failedJobs.filter((j) => shared.some((s) => s.name === j.name)),
				},
				skipped,
			};
		}
		return {
			target: 'bump-pr',
			reason: `#${pr.number} (${pr.headRefName}) is red on ${run.failedJobs.map((j) => j.name).join(', ')}`,
			pr: pick(pr),
			unit: pr.unit,
			bumps: pr.bumps,
			branch: `pin-health/${pr.unit}`,
			baseRef: pr.headRefName,
			run: { id: run.id, failedJobs: run.failedJobs },
			skipped,
		};
	}
	return { target: 'none', reason: 'no red bump PR needs the agent', skipped };
}

function pick(pr) {
	return { number: pr.number, url: pr.url, headRefName: pr.headRefName, headRefOid: pr.headRefOid };
}

function gh(args) {
	return execFileSync('gh', args, { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 });
}

function runWithJobs(id) {
	const view = JSON.parse(gh(['run', 'view', String(id), '--json', 'databaseId,conclusion,jobs']));
	return {
		id: view.databaseId,
		conclusion: view.conclusion,
		failedJobs: view.jobs
			.filter((j) => j.conclusion === 'failure')
			.map((j) => ({ id: j.databaseId, name: j.name })),
	};
}

function latestRun(filterArgs) {
	const [run] = JSON.parse(
		gh([
			'run',
			'list',
			'--workflow',
			'ci.yml',
			'--limit',
			'1',
			'--json',
			'databaseId',
			...filterArgs,
		]),
	);
	return run ? runWithJobs(run.databaseId) : undefined;
}

async function main() {
	const flags = process.argv.slice(2);
	const opt = (name, fallback) => {
		const at = flags.indexOf(name);
		return at === -1 ? fallback : flags[at + 1];
	};
	const out = opt('--out', '/tmp/pin-health/target.json');
	const logs = opt('--logs', '/tmp/pin-health/logs');
	const memoryPath = opt('--memory', '.github/agent-memory/pin-health.md');
	const outdatedPath = opt('--outdated', undefined);

	const fields = 'number,url,headRefName,headRefOid,createdAt,body,labels,comments';
	let prs = JSON.parse(gh(['pr', 'list', '--state', 'open', '--limit', '100', '--json', fields]));
	// --pr narrows the run to one PR in any state, so you can point the controller at a past red bump (#151) or dispatch the workflow at a specific one. Open loop PRs stay in the list because rankCandidates reads their heads.
	const only = opt('--pr', undefined);
	if (only) {
		const loopPrs = prs.filter((p) => p.labels.some((l) => l.name === LOOP_LABEL));
		const one = JSON.parse(gh(['pr', 'view', only, '--json', fields]));
		// --sha replays a past head of that PR. A merged bump's head is its final green commit, so this is the only way to replay the red run it had on the way (#171 at 0da64bd).
		const sha = opt('--sha', undefined);
		if (sha) one.headRefOid = sha;
		prs = [...loopPrs, one];
	}
	const held = existsSync(memoryPath) ? parseHeldPins(readFileSync(memoryPath, 'utf-8')) : [];

	const target = await chooseTarget({
		prs,
		held,
		ciRun: async (sha) => latestRun(['--commit', sha]),
		mainRun: async () => latestRun(['--branch', 'main', '--status', 'completed']),
		rerunAndWait: flags.includes('--no-rerun')
			? undefined
			: async (id) => {
					gh(['run', 'rerun', String(id), '--failed']);
					// `gh run watch` returns once the run completes. Its exit code tracks the conclusion, which runWithJobs reads anyway.
					try {
						gh(['run', 'watch', String(id), '--interval', '30']);
					} catch {}
					return runWithJobs(id);
				},
	});

	if (outdatedPath && existsSync(outdatedPath)) {
		const report = JSON.parse(readFileSync(outdatedPath, 'utf-8'));
		target.gap = report.packages
			.filter((p) => p.behind !== 'up-to-date')
			.map((p) => `${p.name} ${p.pin} → ${p.latest} (${p.behind})`);
	}

	if (target.run) {
		mkdirSync(logs, { recursive: true });
		for (const job of target.run.failedJobs) {
			let text;
			try {
				text = gh(['run', 'view', '--job', String(job.id), '--log-failed']);
			} catch (err) {
				text = `(could not fetch the log: ${err instanceof Error ? err.message : String(err)})`;
			}
			job.log = join(logs, `${job.id}.log`);
			writeFileSync(job.log, text.replace(ANSI, '').split('\n').slice(-LOG_TAIL_LINES).join('\n'));
		}
	}

	mkdirSync(dirname(out), { recursive: true });
	writeFileSync(out, `${JSON.stringify(target, null, '\t')}\n`);
	process.stdout.write(
		`${target.target}: ${target.reason}\n${(target.skipped ?? []).map((s) => `  skipped ${s}`).join('\n')}\n`,
	);
	if (process.env.GITHUB_OUTPUT) {
		writeFileSync(
			process.env.GITHUB_OUTPUT,
			`target=${target.target}\nbranch=${target.branch ?? ''}\nbase_ref=${target.baseRef ?? ''}\n`,
			{ flag: 'a' },
		);
	}
}

if (process.argv[1]?.endsWith('pin-health-controller.mjs')) await main();
