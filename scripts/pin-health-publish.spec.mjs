import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { classifyChange } from './pin-health-classify.mjs';
import { hasEscalation } from './pin-health-controller.mjs';

const PUBLISH = resolve('scripts/pin-health-publish.sh');
const BASELINE = resolve('scripts/pin-health-baseline.sh');
const CLASSIFY = resolve('scripts/pin-health-classify.mjs');
const MEMORY = '.github/agent-memory/pin-health.md';
const HOLD =
	'- `typescript` held at 6 (core-typescript): typescript-eslint has no TS 7 support (#131)';

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim();
const write = (path, text) => writeFileSync(path, text);

// A real origin with main and one bump branch, a clone sitting on the loop branch the way "Check out the target branch" leaves it, and a gh stub that logs each call. Assertions read the pushed branch from origin, which is what a PR would carry.
function fixture({ target = 'bump-pr', oldBump = false } = {}) {
	const root = mkdtempSync(join(tmpdir(), 'pin-health-publish-'));
	const origin = join(root, 'origin.git');
	const seed = join(root, 'seed');
	execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
	execFileSync('git', ['init', '-q', '-b', 'main', seed]);
	git(seed, 'config', 'user.email', 't@t');
	git(seed, 'config', 'user.name', 't');
	execFileSync('mkdir', ['-p', join(seed, '.github/agent-memory')]);
	write(join(seed, MEMORY), '# Memory\n\n## Held Pins\n\n- (none yet)\n');
	write(join(seed, 'package.json'), '{ "typescript": "6.0.3" }\n');
	git(seed, 'add', '-A');
	git(seed, 'commit', '-q', '-m', 'main');
	git(seed, 'remote', 'add', 'origin', origin);
	git(seed, 'push', '-q', 'origin', 'main');
	git(seed, 'checkout', '-q', '-b', 'bump/core-typescript');
	write(join(seed, 'package.json'), '{ "typescript": "7.0.2" }\n');
	// A bump branch cut before the loop landed has no memory file at all.
	if (oldBump) git(seed, 'rm', '-q', MEMORY);
	git(seed, 'commit', '-q', '-am', 'fix(manifest): bump core-typescript pins');
	git(seed, 'push', '-q', 'origin', 'bump/core-typescript');
	const bumpSha = git(seed, 'rev-parse', 'HEAD');

	const work = join(root, 'work');
	execFileSync('git', ['clone', '-q', origin, work]);
	const base = target === 'main-drift' ? 'origin/main' : 'origin/bump/core-typescript';
	const branch = target === 'main-drift' ? 'pin-health/main-drift' : 'pin-health/core-typescript';
	git(work, 'checkout', '-q', '-B', branch, base);
	const targetHead = git(work, 'rev-parse', 'HEAD');

	// The trusted copy holds main's memory file, the way "Copy the loop's tooling" leaves it.
	const tooling = join(root, 'tooling');
	execFileSync('mkdir', ['-p', join(tooling, '.github/agent-memory')]);
	write(join(tooling, MEMORY), `${git(origin, 'show', `main:${MEMORY}`)}\n`);

	const bin = join(root, 'bin');
	execFileSync('mkdir', ['-p', bin]);
	const log = join(root, 'gh.log');
	write(
		join(bin, 'gh'),
		`#!/usr/bin/env bash\necho "gh $*" >> "${log}"\nfor ((i=1;i<=$#;i++)); do if [ "\${!i}" = "--body-file" ]; then j=$((i+1)); cat "\${!j}" >> "${log}"; fi; done\n`,
	);
	chmodSync(join(bin, 'gh'), 0o755);

	// The push goes to github.com by URL; this maps that URL onto the local origin.
	const gitconfig = join(root, 'gitconfig');
	write(
		gitconfig,
		`[url "${origin}"]\n\tinsteadOf = https://x-access-token:tok@github.com/o/r.git\n`,
	);

	const targetJson = join(root, 'target.json');
	write(
		targetJson,
		JSON.stringify({
			target,
			branch,
			unit: 'core-typescript',
			pr: { number: 7, headRefOid: bumpSha },
		}),
	);
	const body = join(root, 'body.md');
	write(body, '## Pin Health: report\n');

	const run = (outcome) =>
		execFileSync('bash', [PUBLISH], {
			cwd: work,
			encoding: 'utf-8',
			env: {
				...process.env,
				PATH: `${bin}:${process.env.PATH}`,
				GIT_CONFIG_GLOBAL: gitconfig,
				OUTCOME: outcome,
				PUSH_TOKEN: 'tok',
				GITHUB_REPOSITORY: 'o/r',
				PIN_HEALTH_TARGET: targetJson,
				PIN_HEALTH_BODY: body,
				TARGET_HEAD: targetHead,
			},
		});
	const baseline = () =>
		execFileSync('bash', [BASELINE], {
			cwd: work,
			encoding: 'utf-8',
			env: { ...process.env, PIN_HEALTH_TOOLING: tooling },
		});
	const classify = () =>
		execFileSync(process.execPath, [CLASSIFY], { cwd: work, encoding: 'utf-8' }).trim();
	const pushed = (path) => git(origin, 'show', `${branch}:${path}`);
	const ghLog = () => {
		try {
			return readFileSync(log, 'utf-8');
		} catch {
			return '';
		}
	};
	return { origin, work, branch, bumpSha, run, pushed, ghLog, baseline, classify };
}

describe('classifyChange', () => {
	it('reads no change as an escalation, a memory-only change as a hold, and anything else as a repair', () => {
		expect(classifyChange([])).toBe('escalate');
		expect(classifyChange([{ status: ' M', path: MEMORY }])).toBe('hold');
		expect(
			classifyChange([
				{ status: ' M', path: MEMORY },
				{ status: ' M', path: 'postcss.config.mjs' },
			]),
		).toBe('repair');
	});
});

// publish.sh and baseline.sh are bash and git, and they run only on agent-pin-health's ubuntu runner.
describe.skipIf(process.platform === 'win32')('pin-health-publish.sh', () => {
	// PR #235 review: a hold committed on top of bump/<unit> carried the rejected bump into main.
	it('publishes a hold from origin/main with only the memory change', () => {
		const f = fixture();
		write(join(f.work, MEMORY), `# Memory\n\n## Held Pins\n\n${HOLD}\n`);
		f.run('hold');
		expect(f.pushed('package.json')).toBe('{ "typescript": "6.0.3" }');
		expect(f.pushed(MEMORY)).toContain(HOLD);
		expect(git(f.origin, 'rev-parse', `${f.branch}^`)).toBe(git(f.origin, 'rev-parse', 'main'));
		expect(f.ghLog()).toContain(
			'gh pr create --base main --head pin-health/core-typescript --title chore(pin-health): recommend holding a core-typescript pin',
		);
	});

	it('publishes a repair on top of the bump, so the bump lands with it', () => {
		const f = fixture();
		write(join(f.work, 'postcss.config.mjs'), 'export default {};\n');
		f.run('repair');
		expect(f.pushed('package.json')).toBe('{ "typescript": "7.0.2" }');
		expect(f.pushed('postcss.config.mjs')).toBe('export default {};');
		expect(git(f.origin, 'rev-parse', `${f.branch}^`)).toBe(f.bumpSha);
		expect(f.ghLog()).toContain('--title fix(manifest): land the core-typescript pin bump');
	});

	it('records a bump-pr escalation on the bump PR with the SHA marker, and pushes nothing', () => {
		const f = fixture();
		f.run('escalate');
		expect(f.ghLog()).toContain('gh pr comment 7 --body-file');
		expect(f.ghLog()).toContain(`<!-- agent-pin-health:escalated sha=${f.bumpSha} -->`);
		expect(() => git(f.origin, 'rev-parse', '--verify', '--quiet', f.branch)).toThrow();
	});

	// PR #235 review: a main-drift escalation left no marker, so the next run paid for the same commit again.
	it('records a main-drift escalation on the bump PR it came through, in a form the controller reads', () => {
		const f = fixture({ target: 'main-drift' });
		f.run('escalate');
		const log = f.ghLog();
		expect(log).toContain('gh pr comment 7 --body-file');
		const comment = log.slice(log.indexOf('## Pin Health'));
		expect(hasEscalation([{ body: comment }], f.bumpSha)).toBe(true);
		expect(hasEscalation([{ body: comment }], 'some-later-sha')).toBe(false);
	});

	// PR #235 review: on a bump branch older than the loop, a hold's diff was a new-file patch, and applying it to main failed with "already exists in index".
	describe('on a bump branch that predates the memory file', () => {
		it('publishes a hold from origin/main with only the memory change', () => {
			const f = fixture({ oldBump: true });
			f.baseline();
			write(
				join(f.work, MEMORY),
				`${git(f.origin, 'show', `main:${MEMORY}`).replace('- (none yet)', HOLD)}\n`,
			);
			expect(f.classify()).toBe('hold');
			f.run('hold');
			expect(f.pushed('package.json')).toBe('{ "typescript": "6.0.3" }');
			expect(f.pushed(MEMORY)).toContain(HOLD);
			expect(git(f.origin, 'diff', '--name-only', 'main', f.branch)).toBe(MEMORY);
		});

		it('reads the memory overlay alone as no change, so a quiet run escalates', () => {
			const f = fixture({ oldBump: true });
			f.baseline();
			expect(f.classify()).toBe('escalate');
		});

		it('publishes a repair on the bump without shipping the overlay', () => {
			const f = fixture({ oldBump: true });
			f.baseline();
			write(join(f.work, 'postcss.config.mjs'), 'export default {};\n');
			expect(f.classify()).toBe('repair');
			f.run('repair');
			expect(git(f.origin, 'rev-parse', `${f.branch}^`)).toBe(f.bumpSha);
			expect(git(f.origin, 'diff', '--name-only', f.bumpSha, f.branch)).toBe('postcss.config.mjs');
		});
	});

	it('keeps a repair from touching the memory file on a current bump branch too', () => {
		const f = fixture();
		f.baseline();
		write(join(f.work, 'postcss.config.mjs'), 'export default {};\n');
		f.run('repair');
		expect(git(f.origin, 'rev-parse', `${f.branch}^`)).toBe(f.bumpSha);
		expect(git(f.origin, 'diff', '--name-only', f.bumpSha, f.branch)).toBe('postcss.config.mjs');
	});
});
