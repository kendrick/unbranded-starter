// The pin-health loop's agent seam: the one file that knows which coding agent runs. The workflow, controller, skill, and scope guard stay agent-neutral, so swapping Claude Code for Codex is a flag change here. Design: .github/control-loops/pin-health.md.
//
//   node scripts/pin-health-actuator.mjs --check-secret [--agent claude|codex]
//   node scripts/pin-health-actuator.mjs [--agent claude|codex] [--target /tmp/pin-health/target.json] [--out /tmp/pr-body.md] [--print] [--local]
//
// --local runs Claude on your own login instead of ANTHROPIC_API_KEY, for replaying a target by hand, and refuses to run in CI. --agent defaults to PIN_HEALTH_AGENT, then claude. --print writes the assembled prompt and the agent command to stdout and runs nothing, which is how to check the seam without spending anything. The pure pieces are exported for the spec.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';

export const PROMPT_TEMPLATE = '.github/agent-prompts/pin-health.md';
export const MEMORY_FILE = '.github/agent-memory/pin-health.md';
export const WORK_DIR = '/tmp/pin-health';

// One agent-neutral policy. Each agent's flags are derived from it, so a policy change is a one-place edit.
export const POLICY = {
	allowedCommands: [
		'pnpm build',
		'pnpm typecheck',
		'pnpm lint',
		'pnpm lint:fix',
		'pnpm test',
		'pnpm vitest run *',
		'pnpm install --frozen-lockfile',
		'pnpm install --lockfile-only',
		'node dist/cli.js *',
		'node scripts/pin-health-validate.mjs *',
		'git status',
		'git status *',
		'git diff *',
		'git log *',
		// Read-only search. No `find` or `rg`: `find -exec` and `rg --pre` both run arbitrary commands.
		'grep *',
		'ls',
		'ls *',
		// Read-only registry lookups. Telling drift from a bad bump means checking what an unpinned dependency resolves to today, and on the #171 replay the agent escalated when it couldn't.
		'pnpm view *',
		'npm view *',
	],
	// Codex has no per-command allowlist, so the closest it gets is forbidding these prefixes. The workflow does every commit, push, and GitHub write itself, after the scope guard.
	forbiddenPrefixes: [['git', ['commit', 'push']], ['gh'], ['curl'], ['npm', 'publish']],
	budgetUsd: 10,
};

export const AGENTS = {
	claude: { secret: 'ANTHROPIC_API_KEY' },
	codex: { secret: 'OPENAI_API_KEY' },
};

export function resolveAgent(flag, env) {
	const agent = flag ?? env.PIN_HEALTH_AGENT ?? 'claude';
	if (!Object.hasOwn(AGENTS, agent))
		throw new Error(`unknown agent "${agent}"; expected ${Object.keys(AGENTS).join(' or ')}`);
	return agent;
}

// Returns the error line for a missing secret, or undefined. The workflow runs this before any install, so a missing key costs seconds and says exactly what to add.
export function missingSecret(agent, env) {
	const { secret } = AGENTS[agent];
	if (env[secret]) return undefined;
	return `::error::${secret} is not set. Add it as a repository secret before running agent-pin-health with --agent ${agent}.`;
}

export function buildPrompt({ template, target, memory }) {
	return `${template.trimEnd()}\n\n## Selected Work\n\n\`\`\`json\n${JSON.stringify(target, null, 2)}\n\`\`\`\n\n## Agent Memory\n\n${memory.trim()}\n`;
}

export function claudeArgs(policy, env = {}) {
	const args = [
		'-p',
		// Project and user settings both carry allow rules for interactive use (this repo's allows curl). Loading only the gitignored local file, which neither a CI checkout nor a fresh worktree has, keeps the allowlist below the whole permission set. Login still works, because auth doesn't come from settings.
		'--setting-sources',
		'local',
		'--strict-mcp-config',
		// The whole tool set, which the allowlist below then narrows. Claude Code 2.1.294 has no Glob or Grep tool, so searching goes through the allowlisted `grep`. --bare would also skip CLAUDE.md, but it drops Write, which the skill needs for repro.json and new specs, so the prompt handles CLAUDE.md instead.
		'--tools',
		'Read,Edit,Write,Bash',
		'--permission-mode',
		'dontAsk',
		'--permission-prompts',
		'none',
		'--allowedTools',
		'Read',
		'Edit',
		'Write',
		...policy.allowedCommands.map((c) => `Bash(${c})`),
		'--add-dir',
		WORK_DIR,
		'--max-budget-usd',
		String(policy.budgetUsd),
		'--output-format',
		'stream-json',
		'--verbose',
	];
	if (env.PIN_HEALTH_MODEL) args.push('--model', env.PIN_HEALTH_MODEL);
	return args;
}

export function codexRules(policy) {
	return policy.forbiddenPrefixes
		.map(
			(pattern) =>
				`prefix_rule(pattern = ${JSON.stringify(pattern)}, decision = "forbidden", justification = "The pin-health workflow does this itself after the scope guard passes.")`,
		)
		.join('\n');
}

export function codexArgs(outPath, env = {}) {
	const args = [
		'exec',
		'--sandbox',
		'workspace-write',
		// pnpm installs and the real-install e2e specs need the registry.
		'-c',
		'sandbox_workspace_write.network_access=true',
		'-c',
		'approval_policy="never"',
		'--json',
		'--output-last-message',
		outPath,
	];
	if (env.PIN_HEALTH_MODEL) args.push('--model', env.PIN_HEALTH_MODEL);
	// The prompt arrives on stdin.
	args.push('-');
	return args;
}

// Claude's stream-json ends with a `result` event carrying the final text. A budget stop or error ends with an error subtype instead, and that has to fail the step: an empty PR body would read as "nothing to report".
export function extractClaudeResult(streamJson) {
	let result;
	for (const line of streamJson.split('\n')) {
		if (!line.startsWith('{')) continue;
		let event;
		try {
			event = JSON.parse(line);
		} catch {
			continue;
		}
		if (event.type === 'result') result = event;
	}
	if (!result) return { ok: false, error: 'no result event in the agent output' };
	if (result.subtype !== 'success' || result.is_error)
		return { ok: false, error: `agent stopped: ${result.subtype}` };
	return { ok: true, text: result.result ?? '' };
}

// What to do about the API key before a run. --local skips it so a maintainer can replay a target on their own Claude login, but only off CI: a workflow that forgot the secret has to fail, not fall back to some other login.
export function secretCheck({ agent, local, env }) {
	if (!local) {
		const error = missingSecret(agent, env);
		return error ? { error } : { ok: true };
	}
	if (env.CI || env.GITHUB_ACTIONS)
		return {
			error: '::error::--local is for a maintainer machine. CI runs use the repository secret.',
		};
	if (agent !== 'claude')
		return { error: `--local supports --agent claude only; ${agent} logs in with its API key.` };
	return { ok: true };
}

function runClaude(prompt, outPath) {
	// The prompt goes on stdin. As a trailing argument it would sit right after the variadic --allowedTools list, one flag reorder away from being read as a tool name.
	const proc = spawnSync('claude', claudeArgs(POLICY, process.env), {
		input: prompt,
		encoding: 'utf-8',
		maxBuffer: 256 * 1024 * 1024,
		stdio: ['pipe', 'pipe', 'inherit'],
	});
	writeFileSync(join(WORK_DIR, 'agent-output.jsonl'), proc.stdout ?? '');
	const result = extractClaudeResult(proc.stdout ?? '');
	if (!result.ok) throw new Error(result.error);
	writeFileSync(outPath, result.text);
}

function runCodex(prompt, outPath) {
	// A throwaway CODEX_HOME holds the forbidden-prefix rules and the API-key login, so neither depends on project trust or leaks into the runner's home.
	const home = mkdtempSync(join(tmpdir(), 'pin-health-codex-'));
	mkdirSync(join(home, 'rules'));
	writeFileSync(join(home, 'rules', 'pin-health.rules'), `${codexRules(POLICY)}\n`);
	const env = { ...process.env, CODEX_HOME: home };
	execFileSync('codex', ['login', '--with-api-key'], {
		input: process.env.OPENAI_API_KEY,
		env,
		stdio: ['pipe', 'inherit', 'inherit'],
	});
	const proc = spawnSync('codex', codexArgs(outPath, process.env), {
		input: prompt,
		encoding: 'utf-8',
		env,
		maxBuffer: 256 * 1024 * 1024,
		stdio: ['pipe', 'pipe', 'inherit'],
	});
	writeFileSync(join(WORK_DIR, 'agent-output.jsonl'), proc.stdout ?? '');
	if (proc.status !== 0) throw new Error(`codex exited ${proc.status}`);
	if (!existsSync(outPath)) throw new Error('codex wrote no final message');
}

function main() {
	const flags = process.argv.slice(2);
	const opt = (name, fallback) => {
		const at = flags.indexOf(name);
		return at === -1 ? fallback : flags[at + 1];
	};
	const agent = resolveAgent(opt('--agent', undefined), process.env);

	if (flags.includes('--check-secret')) {
		const error = missingSecret(agent, process.env);
		if (error) {
			process.stdout.write(`${error}\n`);
			process.exit(1);
		}
		process.stdout.write(`${AGENTS[agent].secret} is set.\n`);
		return;
	}

	const targetPath = opt('--target', join(WORK_DIR, 'target.json'));
	const outPath = opt('--out', '/tmp/pr-body.md');
	const prompt = buildPrompt({
		template: readFileSync(PROMPT_TEMPLATE, 'utf-8'),
		target: JSON.parse(readFileSync(targetPath, 'utf-8')),
		memory: readFileSync(MEMORY_FILE, 'utf-8'),
	});
	mkdirSync(WORK_DIR, { recursive: true });
	writeFileSync(join(WORK_DIR, 'prompt.md'), prompt);

	if (flags.includes('--print')) {
		const argv =
			agent === 'claude'
				? ['claude', ...claudeArgs(POLICY, process.env), '< prompt.md']
				: ['codex', ...codexArgs(outPath, process.env)];
		process.stdout.write(`${prompt}\n---\n${argv.join(' ')}\n`);
		if (agent === 'codex') process.stdout.write(`---\n${codexRules(POLICY)}\n`);
		return;
	}

	const { error } = secretCheck({ agent, local: flags.includes('--local'), env: process.env });
	if (error) {
		process.stdout.write(`${error}\n`);
		process.exit(1);
	}
	try {
		if (agent === 'claude') runClaude(prompt, outPath);
		else runCodex(prompt, outPath);
	} catch (err) {
		process.stderr.write(
			`pin-health actuator (${agent}): ${err instanceof Error ? err.message : String(err)}\n`,
		);
		process.exit(1);
	}
	process.stdout.write(`pin-health actuator (${agent}): final message written to ${outPath}\n`);
}

if (process.argv[1]?.endsWith('pin-health-actuator.mjs')) main();
