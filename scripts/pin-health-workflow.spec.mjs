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

	// PR #235 review: the old classify step only asked whether code changed, so a hold sitting on a bump branch skipped validation and still carried the bump.
	it('validates only repairs, and publishes through the script that rebases holds onto main', () => {
		const step = (name) => {
			const start = stepIndex(name);
			return lines
				.slice(
					start,
					lines.findIndex((l, i) => i > start && l.trim().startsWith('- name:')),
				)
				.join('\n');
		};
		expect(step('Classify the change')).toContain('pin-health-classify.mjs');
		expect(step('Validate')).toContain("if: steps.change.outputs.outcome == 'repair'");
		expect(step('Publish the result')).toMatch(
			/OUTCOME: \$\{\{ steps\.change\.outputs\.outcome \}\}/,
		);
		expect(step('Publish the result')).toContain(
			'"$PIN_HEALTH_TOOLING/scripts/pin-health-publish.sh"',
		);
		expect(step("Copy the loop's tooling")).toContain('scripts/pin-health-*.sh');
	});

	// PR #235 review: a bump that broke its own install or build killed the checkout step, so nothing was investigated and the same target came back every run.
	it('keeps the target install and build out of the checkout step, and runs the agent on a setup failure', () => {
		const step = (name) => {
			const start = stepIndex(name);
			expect(start, name).toBeGreaterThan(-1);
			return lines
				.slice(
					start,
					lines.findIndex((l, i) => i > start && l.trim().startsWith('- name:')),
				)
				.join('\n');
		};
		expect(step('Check out the target branch')).not.toMatch(/\bpnpm\b/);
		expect(step('Set up the target')).toContain(
			'"$PIN_HEALTH_TOOLING/scripts/pin-health-setup.mjs"',
		);
		expect(stepIndex('Set up the target')).toBeGreaterThan(
			stepIndex('Check out the target branch'),
		);
		expect(stepIndex('Set up the target')).toBeLessThan(stepIndex('Actuator - run the agent'));
		expect(step('Actuator - run the agent')).toContain("if: steps.branch.outcome == 'success'");
		expect(step('Actuator - run the agent')).not.toContain('steps.setup');
	});
});
