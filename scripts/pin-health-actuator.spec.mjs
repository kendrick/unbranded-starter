import { describe, expect, it } from 'vitest';
import {
	allowedCommands,
	buildPrompt,
	claudeArgs,
	codexArgs,
	codexRules,
	extractClaudeResult,
	missingSecret,
	POLICY,
	resolveAgent,
	secretCheck,
	toolingPaths,
} from './pin-health-actuator.mjs';

describe('resolveAgent', () => {
	it('prefers the flag, then PIN_HEALTH_AGENT, then claude', () => {
		expect(resolveAgent('codex', { PIN_HEALTH_AGENT: 'claude' })).toBe('codex');
		expect(resolveAgent(undefined, { PIN_HEALTH_AGENT: 'codex' })).toBe('codex');
		expect(resolveAgent(undefined, {})).toBe('claude');
	});
	it('rejects an unknown agent', () => {
		expect(() => resolveAgent('opencode', {})).toThrow(/unknown agent/);
	});
});

describe('missingSecret', () => {
	it('names the selected agent secret as a GitHub error annotation', () => {
		expect(missingSecret('claude', {})).toBe(
			'::error::ANTHROPIC_API_KEY is not set. Add it as a repository secret before running agent-pin-health with --agent claude.',
		);
		expect(missingSecret('codex', { ANTHROPIC_API_KEY: 'x' })).toMatch(
			/^::error::OPENAI_API_KEY is not set/,
		);
	});
	it('is quiet when the secret exists', () => {
		expect(missingSecret('claude', { ANTHROPIC_API_KEY: 'sk-test' })).toBeUndefined();
	});
	it('treats an empty secret as missing, which is what Actions passes for an unset one', () => {
		expect(missingSecret('claude', { ANTHROPIC_API_KEY: '' })).toBeDefined();
	});
});

describe('the trusted tooling copy', () => {
	const tooling = toolingPaths('/runner/tmp/pin-health-tooling');

	// PR #235 review: the validator the agent may run has to be the trusted copy, not the target branch's.
	it('points the validator rule at the trusted copy', () => {
		const args = claudeArgs(POLICY, {}, tooling);
		expect(args).toContain(
			'Bash(node /runner/tmp/pin-health-tooling/scripts/pin-health-validate.mjs *)',
		);
		expect(args).not.toContain('Bash(node scripts/pin-health-validate.mjs *)');
	});

	it('gives Claude read access to the copy, where the skill lives', () => {
		const args = claudeArgs(POLICY, {}, tooling);
		const dirs = args.flatMap((a, i) => (a === '--add-dir' ? [args[i + 1]] : []));
		expect(dirs).toEqual(['/tmp/pin-health', '/runner/tmp/pin-health-tooling']);
	});

	it('names the skill, references, validator, and scope guard in the prompt', () => {
		const prompt = buildPrompt({
			template: '# Context\n',
			target: { target: 'none' },
			memory: '',
			tooling,
		});
		for (const path of [
			'/runner/tmp/pin-health-tooling/.claude/skills/repair-pin-bump/SKILL.md',
			'/runner/tmp/pin-health-tooling/.claude/skills/repair-pin-bump/references/',
			'node /runner/tmp/pin-health-tooling/scripts/pin-health-validate.mjs',
			'/runner/tmp/pin-health-tooling/scripts/pin-health-scope-guard.mjs',
		])
			expect(prompt).toContain(path);
		expect(prompt.indexOf('## Tooling')).toBeLessThan(prompt.indexOf('## Selected Work'));
	});

	it('stays repo-relative by default, for local runs', () => {
		expect(toolingPaths('.').validator).toBe('scripts/pin-health-validate.mjs');
	});
});

describe('buildPrompt', () => {
	it('puts the controller target before the memory, after the template', () => {
		const prompt = buildPrompt({
			template: '# Context\n',
			target: { target: 'none' },
			memory: '# Memory\n',
		});
		expect(prompt.indexOf('# Context')).toBeLessThan(prompt.indexOf('## Selected Work'));
		expect(prompt.indexOf('## Selected Work')).toBeLessThan(prompt.indexOf('## Agent Memory'));
		expect(prompt).toContain('"target": "none"');
	});
});

describe('claudeArgs', () => {
	const args = claudeArgs(POLICY);
	it('never bypasses permissions', () => {
		expect(args).not.toContain('bypassPermissions');
		expect(args).not.toContain('--dangerously-skip-permissions');
		expect(
			args.slice(args.indexOf('--permission-mode'), args.indexOf('--permission-mode') + 2),
		).toEqual(['--permission-mode', 'dontAsk']);
	});
	it('allows exactly the policy commands as Bash rules', () => {
		const bash = args.filter((a) => a.startsWith('Bash('));
		expect(bash).toEqual(allowedCommands(POLICY, toolingPaths('.')).map((c) => `Bash(${c})`));
		expect(bash).toContain('Bash(node scripts/pin-health-validate.mjs *)');
		expect(bash.some((a) => /git (commit|push)|\bgh\b|curl|\bfind\b|\brg\b/.test(a))).toBe(false);
	});
	it('lets the agent query the registry read-only, as Bash rules', () => {
		expect(args).toEqual(expect.arrayContaining(['Bash(pnpm view *)', 'Bash(npm view *)']));
	});
	it('caps spend and loads no project settings', () => {
		expect(args[args.indexOf('--max-budget-usd') + 1]).toBe('10');
		expect(args[args.indexOf('--setting-sources') + 1]).toBe('local');
		expect(args).toContain('--strict-mcp-config');
	});
	it('passes a model override through', () => {
		expect(claudeArgs(POLICY, { PIN_HEALTH_MODEL: 'opus' }).slice(-2)).toEqual(['--model', 'opus']);
	});
});

describe('codexArgs and codexRules', () => {
	it('runs sandboxed with network, never asks, and reads the prompt from stdin', () => {
		const args = codexArgs('/tmp/pr-body.md');
		expect(args).toEqual(
			expect.arrayContaining([
				'workspace-write',
				'sandbox_workspace_write.network_access=true',
				'approval_policy="never"',
			]),
		);
		expect(args).not.toContain('danger-full-access');
		expect(args.at(-1)).toBe('-');
		expect(args[args.indexOf('--output-last-message') + 1]).toBe('/tmp/pr-body.md');
	});
	it('forbids every policy prefix and allows nothing, since a Codex allow rule skips the sandbox', () => {
		const rules = codexRules(POLICY);
		expect(rules.split('\n')).toHaveLength(POLICY.forbiddenPrefixes.length);
		expect(rules).toContain('pattern = ["git",["commit","push"]]');
		expect(rules).toContain('pattern = ["gh"]');
		expect(rules).not.toContain('"allow"');
		// The registry lookups are allowlisted for Claude and must stay runnable under Codex.
		expect(rules).not.toContain('"view"');
	});
});

describe('extractClaudeResult', () => {
	const lines = (...events) => events.map((e) => JSON.stringify(e)).join('\n');
	it('returns the final result text', () => {
		const out = lines(
			{ type: 'system', subtype: 'init' },
			{ type: 'assistant', message: { content: [{ type: 'text', text: 'working' }] } },
			{ type: 'result', subtype: 'success', is_error: false, result: '## Pin Health\n\nRepaired.' },
		);
		expect(extractClaudeResult(`noise\n${out}\n`)).toEqual({
			ok: true,
			text: '## Pin Health\n\nRepaired.',
		});
	});
	it('fails on a budget stop', () => {
		expect(
			extractClaudeResult(
				lines({ type: 'result', subtype: 'error_max_budget_usd', is_error: true }),
			),
		).toEqual({
			ok: false,
			error: 'agent stopped: error_max_budget_usd',
		});
	});
	it('fails when the stream never finished', () => {
		expect(extractClaudeResult(lines({ type: 'system' })).ok).toBe(false);
	});
});

describe('secretCheck', () => {
	it('requires the secret without --local', () => {
		expect(secretCheck({ agent: 'claude', local: false, env: {} }).error).toMatch(
			/ANTHROPIC_API_KEY is not set/,
		);
		expect(secretCheck({ agent: 'claude', local: false, env: { ANTHROPIC_API_KEY: 'k' } })).toEqual(
			{ ok: true },
		);
	});
	it('lets --local run Claude on a maintainer login with no key', () => {
		expect(secretCheck({ agent: 'claude', local: true, env: {} })).toEqual({ ok: true });
	});
	// GitHub Actions sets both CI and GITHUB_ACTIONS on every runner, so either one refuses --local.
	it.each([[{ CI: 'true' }], [{ GITHUB_ACTIONS: 'true' }]])('refuses --local in CI (%o)', (env) => {
		expect(secretCheck({ agent: 'claude', local: true, env }).error).toMatch(/^::error::--local/);
	});
	it('refuses --local for Codex, which only logs in with its key here', () => {
		expect(secretCheck({ agent: 'codex', local: true, env: {} }).error).toMatch(/claude only/);
	});
});
