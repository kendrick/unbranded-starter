import { describe, expect, it } from 'vitest';
import {
	chooseTarget,
	hasEscalation,
	isFullyHeld,
	parseBumpLines,
	parseHeldPins,
	rankCandidates,
	sharedFailures,
} from './pin-health-controller.mjs';

// The body bump-pins.mjs actually writes (#207), so the parser is held to the real producer's format.
const BUMP_BODY =
	"Weekly pin refresh for core-eslint, from `unbranded outdated --json`. Merge gate is this unit's own CI.\n\n- @antfu/eslint-config 9.5.1 → 10.0.0\n- eslint 10.11.0 → 10.12.0";

const pr = (over) => ({
	number: 1,
	url: 'https://github.com/o/r/pull/1',
	headRefName: 'bump/core-eslint',
	headRefOid: 'aaaaaaaaaaaa',
	createdAt: '2026-10-19T12:00:00Z',
	body: BUMP_BODY,
	labels: [],
	comments: [],
	...over,
});

describe('parseBumpLines', () => {
	it('reads every pin line from a bump-pins body', () => {
		expect(parseBumpLines(BUMP_BODY)).toEqual([
			{ name: '@antfu/eslint-config', from: '9.5.1', to: '10.0.0' },
			{ name: 'eslint', from: '10.11.0', to: '10.12.0' },
		]);
	});
});

describe('parseHeldPins', () => {
	it('reads bullets under the Held pins heading only', () => {
		const memory = [
			'# Agent Memory: Pin Health',
			'## Guidance',
			'- `vitest` held at 1 (core-vitest): not a hold, wrong section',
			'## Held pins',
			'- `typescript` held at 6 (core-typescript): typescript-eslint has no TS 7 support (#131)',
			'- (none yet)',
			'## Other',
			'- `eslint` held at 9 (core-eslint): also wrong section',
		].join('\n');
		expect(parseHeldPins(memory)).toEqual([{ name: 'typescript', major: 6 }]);
	});
});

describe('isFullyHeld', () => {
	const held = [{ name: '@antfu/eslint-config', major: 9 }];
	it('is true when every bump crosses a held major', () => {
		expect(isFullyHeld([{ name: '@antfu/eslint-config', from: '9.5.1', to: '10.0.0' }], held)).toBe(
			true,
		);
	});
	it('is false when any bump is outside the holds', () => {
		expect(isFullyHeld(parseBumpLines(BUMP_BODY), held)).toBe(false);
	});
	it('is false for a minor inside the held major', () => {
		expect(isFullyHeld([{ name: '@antfu/eslint-config', from: '9.5.1', to: '9.6.0' }], held)).toBe(
			false,
		);
	});
	it('is false for a PR with no bump lines', () => {
		expect(isFullyHeld([], held)).toBe(false);
	});
});

describe('hasEscalation', () => {
	it('matches only the SHA the escalation looked at', () => {
		const comments = [{ body: 'report\n<!-- agent-pin-health:escalated sha=abc123 -->' }];
		expect(hasEscalation(comments, 'abc123')).toBe(true);
		expect(hasEscalation(comments, 'def456')).toBe(false);
	});
});

describe('sharedFailures', () => {
	it('matches jobs by name, keeping the PR side', () => {
		expect(
			sharedFailures(
				[
					{ id: 1, name: 'e2e preset next-app' },
					{ id: 2, name: 'x' },
				],
				[{ id: 9, name: 'e2e preset next-app' }],
			),
		).toEqual([{ id: 1, name: 'e2e preset next-app' }]);
	});
});

describe('rankCandidates', () => {
	it('drops non-bump PRs, units with an open loop PR, held PRs, and escalated SHAs, then sorts oldest first', () => {
		const prs = [
			pr({
				number: 5,
				headRefName: 'bump/core-vitest',
				createdAt: '2026-10-19T12:00:05Z',
				body: '- vitest 5.0.4 → 5.0.5',
			}),
			pr({
				number: 4,
				headRefName: 'bump/opt-monorepo',
				createdAt: '2026-10-19T12:00:01Z',
				body: '- turbo 2.11.9 → 2.11.10',
			}),
			pr({ number: 3, headRefName: 'release-please--branches--main' }),
			pr({
				number: 2,
				headRefName: 'pin-health/core-oxlint',
				labels: [{ name: 'agent-pin-health' }],
			}),
			pr({ number: 6, headRefName: 'bump/core-oxlint', body: '- oxlint 1.86.0 → 1.89.0' }),
			pr({ number: 7, headRefName: 'bump/core-typescript', body: '- typescript 6.0.3 → 7.0.2' }),
			pr({
				number: 8,
				headRefName: 'bump/core-eslint',
				comments: [{ body: '<!-- agent-pin-health:escalated sha=aaaaaaaaaaaa -->' }],
			}),
		];
		const { candidates, skipped } = rankCandidates({
			prs,
			held: [{ name: 'typescript', major: 6 }],
		});
		expect(candidates.map((c) => c.number)).toEqual([4, 5]);
		expect(candidates[0].unit).toBe('opt-monorepo');
		expect(skipped).toHaveLength(3);
	});
});

describe('chooseTarget', () => {
	const red = (id, names) => ({
		id,
		conclusion: 'failure',
		failedJobs: names.map((name, i) => ({ id: id * 10 + i, name })),
	});
	const green = (id) => ({ id, conclusion: 'success', failedJobs: [] });

	it('targets the oldest bump PR that stays red after one re-run', async () => {
		const prs = [
			pr({
				number: 1,
				headRefName: 'bump/a',
				headRefOid: 'sha-a',
				createdAt: '2026-10-19T12:00:01Z',
				body: '- x 1.0.0 → 1.0.1',
			}),
			pr({
				number: 2,
				headRefName: 'bump/b',
				headRefOid: 'sha-b',
				createdAt: '2026-10-19T12:00:02Z',
				body: '- y 1.0.0 → 1.0.1',
			}),
		];
		const runs = { 'sha-a': red(100, ['e2e main']), 'sha-b': red(200, ['e2e preset cli']) };
		const target = await chooseTarget({
			prs,
			held: [],
			ciRun: async (sha) => runs[sha],
			mainRun: async () => green(900),
			// a's failure was a flake; b's reproduces.
			rerunAndWait: async (id) => (id === 100 ? green(100) : red(200, ['e2e preset cli'])),
		});
		expect(target.target).toBe('bump-pr');
		expect(target.pr.number).toBe(2);
		expect(target.branch).toBe('pin-health/b');
		expect(target.baseRef).toBe('bump/b');
		expect(target.run.failedJobs.map((j) => j.name)).toEqual(['e2e preset cli']);
		expect(target.skipped).toContain('#1: went green on re-run (flake)');
	});

	it('targets main drift when main fails the same job', async () => {
		const target = await chooseTarget({
			prs: [pr({})],
			held: [],
			ciRun: async () => red(100, ['e2e preset next-app', 'e2e main']),
			mainRun: async () => red(900, ['e2e preset next-app']),
			rerunAndWait: undefined,
		});
		expect(target.target).toBe('main-drift');
		expect(target.branch).toBe('pin-health/main-drift');
		expect(target.baseRef).toBe('main');
		expect(target.run).toEqual({
			id: 900,
			failedJobs: [{ id: 9000, name: 'e2e preset next-app' }],
		});
	});

	it('skips the re-run when none is injected (local --no-rerun) and ignores green PRs', async () => {
		const target = await chooseTarget({
			prs: [pr({})],
			held: [],
			ciRun: async () => green(100),
			mainRun: async () => green(900),
		});
		expect(target.target).toBe('none');
	});

	// #151's CI run reports conclusion failure with an empty job list, which is the shape this guards.
	it('skips a failed run that has no failing job', async () => {
		const target = await chooseTarget({
			prs: [pr({})],
			held: [],
			ciRun: async () => ({ id: 1, conclusion: 'failure', failedJobs: [] }),
			mainRun: async () => green(900),
		});
		expect(target.target).toBe('none');
		expect(target.skipped).toEqual(['#1: CI failed without a failing job']);
	});

	it('stops re-running past the cap', async () => {
		const prs = [1, 2, 3].map((n) =>
			pr({
				number: n,
				headRefName: `bump/u${n}`,
				headRefOid: `s${n}`,
				createdAt: `2026-10-19T12:00:0${n}Z`,
				body: '- x 1.0.0 → 1.0.1',
			}),
		);
		let reruns = 0;
		const target = await chooseTarget({
			prs,
			held: [],
			ciRun: async (sha) => red(Number(sha.slice(1)), ['e2e main']),
			mainRun: async () => green(900),
			rerunAndWait: async (id) => {
				reruns += 1;
				return green(id);
			},
			maxReruns: 2,
		});
		expect(reruns).toBe(2);
		expect(target.target).toBe('none');
		expect(target.skipped).toContain('#3: re-run cap reached this run');
	});
});
