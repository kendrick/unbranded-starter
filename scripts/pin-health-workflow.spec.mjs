import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Text checks over the workflow itself, the consumer that decides which copy of the loop's files actually runs.
const WORKFLOW = readFileSync('.github/workflows/agent-pin-health.yml', 'utf-8');
const lines = WORKFLOW.split('\n');
const stepIndex = (name) => lines.findIndex((l) => l.trim() === `- name: ${name}`);

describe('agent-pin-health.yml', () => {
	// PR #235 review: the target branch's own scripts judged the target branch, and an older bump branch had no scripts at all.
	it('runs every loop script from the trusted copy', () => {
		const invocations = lines.filter(
			(l) => !l.trim().startsWith('#') && /pin-health-[\w-]+\.(?:mjs|sh)\b/.test(l),
		);
		expect(invocations.length).toBeGreaterThan(0);
		for (const line of invocations) expect(line).toContain('"$PIN_HEALTH_TOOLING/scripts/');
	});

	it('takes the copy before the target branch replaces the checkout', () => {
		const copy = stepIndex("Copy the loop's tooling");
		expect(copy).toBeGreaterThan(-1);
		expect(copy).toBeLessThan(stepIndex('Check out the target branch'));
		expect(copy).toBeLessThan(stepIndex('Check the agent secret'));
	});

	it('copies everything the actuator reads from the tooling directory', () => {
		const start = stepIndex("Copy the loop's tooling");
		const step = lines
			.slice(
				start,
				lines.findIndex((l, i) => i > start && l.trim().startsWith('- name:')),
			)
			.join('\n');
		for (const path of [
			'scripts/pin-health-',
			'.claude/skills/repair-pin-bump',
			'.github/agent-prompts/pin-health.md',
			'.github/agent-memory/pin-health.md',
		]) {
			expect(step).toContain(path);
		}
	});
});
