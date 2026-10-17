import { spawnSync } from 'node:child_process';
import {
	existsSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { baselinePath, hashBuffer, legacyBaselinePath } from '../../src/state/state';
import { PKG_ROOT } from '../../src/util/paths';

const CLI = join(PKG_ROOT, 'dist/cli.js');

// The shipped .editorconfig template is "theirs". There is no second template
// generation to install against, so the past is simulated instead: the baseline
// and recorded hash are rewritten to a doctored OLD version (its first line
// differs), which is indistinguishable from a scaffold that ran before the
// template moved on.
const TEMPLATE = readFileSync(join(PKG_ROOT, '.editorconfig'), 'utf-8');
const OLD = `# previous header\n${TEMPLATE.split('\n').slice(1).join('\n')}`;

function scaffold(tmp: string): void {
	writeFileSync(
		join(tmp, 'package.json'),
		JSON.stringify({ name: 'update-me', version: '0.0.0' }, null, 2),
	);
	writeFileSync(
		join(tmp, 'recipe.json'),
		JSON.stringify(
			{
				units: ['core-editorconfig', 'core-vitest', 'opt-vscode'],
				pm: null,
				onConflict: 'overwrite',
				postInstall: 'none',
			},
			null,
			2,
		),
	);
	const applied = spawnSync('node', [CLI, '--config', 'recipe.json'], {
		cwd: tmp,
		encoding: 'utf-8',
	});
	expect(applied.status, `scaffold stderr: ${applied.stderr}`).toBe(0);
}

// Rewind history: the scaffold "wrote" OLD, and the user's disk holds `disk`.
function drift(tmp: string, disk: string): void {
	writeFileSync(join(tmp, '.editorconfig'), disk);
	writeFileSync(join(tmp, '.unbranded', 'baseline', '.editorconfig.base'), OLD);
	const statePath = join(tmp, '.unbranded.json');
	const state = JSON.parse(readFileSync(statePath, 'utf-8')) as { files: Record<string, string> };
	state.files['.editorconfig'] = hashBuffer(Buffer.from(OLD));
	writeFileSync(statePath, `${JSON.stringify(state, null, '\t')}\n`);
}

// Turn a fresh scaffold back into a pre-#182 one: schema 3, every copy-mode baseline
// under its real name. Returns the rels it moved and their bytes.
function legacySidecar(tmp: string): Record<string, string> {
	const statePath = join(tmp, '.unbranded.json');
	const state = JSON.parse(readFileSync(statePath, 'utf-8')) as {
		schema: number;
		files: Record<string, string>;
		modes: Record<string, string>;
	};
	const moved: Record<string, string> = {};
	for (const rel of Object.keys(state.files).filter((r) => state.modes[r] === 'copy')) {
		const bytes = readFileSync(baselinePath(tmp, rel), 'utf-8');
		renameSync(baselinePath(tmp, rel), legacyBaselinePath(tmp, rel));
		moved[rel] = bytes;
	}
	state.schema = 3;
	writeFileSync(statePath, `${JSON.stringify(state, null, '\t')}\n`);
	return moved;
}

function hashSidecar(tmp: string): Record<string, string> {
	const root = join(tmp, '.unbranded');
	const out: Record<string, string> = {};
	for (const rel of readdirSync(root, { recursive: true }) as string[]) {
		if (statSync(join(root, rel)).isFile()) out[rel] = hashBuffer(readFileSync(join(root, rel)));
	}
	return out;
}

function run(args: string[], cwd: string): ReturnType<typeof spawnSync<string>> {
	return spawnSync('node', [CLI, ...args], { cwd, encoding: 'utf-8' });
}

function baseline(tmp: string): string {
	return readFileSync(join(tmp, '.unbranded', 'baseline', '.editorconfig.base'), 'utf-8');
}

describe('unbranded update', () => {
	let tmp: string;

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-e2e-update-'));
	});

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	it('reports everything up to date right after a scaffold', () => {
		scaffold(tmp);
		const result = run(['update', '--yes'], tmp);
		expect(result.status, result.stderr).toBe(0);
		expect(result.stdout).toContain('Everything up to date.');
	});

	it('applies a clean update to an untouched file and advances the baseline', () => {
		scaffold(tmp);
		drift(tmp, OLD);

		const result = run(['update', '--yes'], tmp);
		expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);

		expect(readFileSync(join(tmp, '.editorconfig'), 'utf-8')).toBe(TEMPLATE);
		expect(baseline(tmp)).toBe(TEMPLATE);
	});

	it('three-way merges a user edit with the template change', () => {
		scaffold(tmp);
		drift(tmp, `${OLD}# my extra rule\n`);

		const result = run(['update', '--yes'], tmp);
		expect(result.status, result.stdout).toBe(0);

		// The template's new first line AND the user's trailing rule both land.
		expect(readFileSync(join(tmp, '.editorconfig'), 'utf-8')).toBe(`${TEMPLATE}# my extra rule\n`);
	});

	it('fails a --yes run on a conflict rather than guessing, then honors --strategy', () => {
		scaffold(tmp);
		// The user rewrote the same first line the template changed: a true conflict.
		drift(tmp, `# my own header\n${TEMPLATE.split('\n').slice(1).join('\n')}`);

		const refused = run(['update', '--yes'], tmp);
		expect(refused.status).toBe(1);
		expect(`${refused.stdout}${refused.stderr}`).toContain('--strategy');

		const taken = run(['update', '--yes', '--strategy', 'theirs'], tmp);
		expect(taken.status, taken.stdout).toBe(0);
		expect(readFileSync(join(tmp, '.editorconfig'), 'utf-8')).toBe(TEMPLATE);
	});

	it('keeps mine under --strategy ours but still advances the baseline', () => {
		scaffold(tmp);
		const mine = `# my own header\n${TEMPLATE.split('\n').slice(1).join('\n')}`;
		drift(tmp, mine);

		const result = run(['update', '--yes', '--strategy', 'ours'], tmp);
		expect(result.status, result.stdout).toBe(0);

		// The file the user chose to keep is untouched…
		expect(readFileSync(join(tmp, '.editorconfig'), 'utf-8')).toBe(mine);
		// …and the baseline still moves to the current template, so the next run
		// doesn't re-litigate (or silently overturn) this decision.
		expect(baseline(tmp)).toBe(TEMPLATE);
		const rerun = run(['update', '--yes'], tmp);
		expect(rerun.status).toBe(0);
		expect(rerun.stdout).toContain('Everything up to date.');
	});

	it('writes conflict markers under --strategy markers', () => {
		scaffold(tmp);
		drift(tmp, `# my own header\n${TEMPLATE.split('\n').slice(1).join('\n')}`);

		const result = run(['update', '--yes', '--strategy', 'markers'], tmp);
		expect(result.status, result.stdout).toBe(0);
		const content = readFileSync(join(tmp, '.editorconfig'), 'utf-8');
		expect(content).toContain('<<<<<<< yours');
		expect(content).toContain('>>>>>>> template');
	});

	it('restores lost package.json entries through the structured merge', () => {
		scaffold(tmp);
		// The user deleted a script and a dep the units still ship.
		const pkgPath = join(tmp, 'package.json');
		const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as {
			scripts: Record<string, string>;
			devDependencies: Record<string, string>;
		};
		delete pkg.scripts['test:watch'];
		delete pkg.devDependencies.jsdom;
		writeFileSync(pkgPath, `${JSON.stringify(pkg, null, '\t')}\n`);

		const result = run(['update', '--yes'], tmp);
		expect(result.status, result.stdout).toBe(0);

		const after = JSON.parse(readFileSync(pkgPath, 'utf-8')) as typeof pkg;
		expect(after.scripts['test:watch']).toBe('vitest');
		expect(after.devDependencies.jsdom).toBeDefined();
		// The lockfile is now behind; update says so instead of spawning installs.
		expect(result.stdout).toContain('install');
	});

	it('changes nothing under --dry-run and shows the plan', () => {
		scaffold(tmp);
		drift(tmp, OLD);
		const before = readFileSync(join(tmp, '.unbranded.json'), 'utf-8');

		const result = run(['update', '--dry-run'], tmp);
		expect(result.status, result.stderr).toBe(0);
		expect(result.stdout).toContain('update');

		expect(readFileSync(join(tmp, '.editorconfig'), 'utf-8')).toBe(OLD);
		expect(readFileSync(join(tmp, '.unbranded.json'), 'utf-8')).toBe(before);
	});

	it('moves legacy-named baselines on an update with nothing else to do', () => {
		// A schema-3 project whose files are all current returns at "Everything up to
		// date." without a state write. Unless runUpdate migrates first, its legacy
		// copies stay live config for oxfmt to reformat (#182).
		scaffold(tmp);
		const moved = legacySidecar(tmp);
		expect(Object.keys(moved)).toEqual(expect.arrayContaining(['.editorconfig']));

		const result = run(['update', '--yes'], tmp);
		expect(result.status, result.stderr).toBe(0);
		expect(result.stdout).toContain('Everything up to date.');

		for (const [rel, bytes] of Object.entries(moved)) {
			expect(existsSync(legacyBaselinePath(tmp, rel)), `${rel} legacy copy`).toBe(false);
			expect(readFileSync(baselinePath(tmp, rel), 'utf-8'), `${rel} .base copy`).toBe(bytes);
		}
	});

	it('leaves a legacy sidecar byte-identical under --dry-run', () => {
		scaffold(tmp);
		legacySidecar(tmp);
		const before = hashSidecar(tmp);
		const stateBefore = readFileSync(join(tmp, '.unbranded.json'), 'utf-8');

		const result = run(['update', '--dry-run'], tmp);
		expect(result.status, result.stderr).toBe(0);

		expect(hashSidecar(tmp)).toEqual(before);
		expect(readFileSync(join(tmp, '.unbranded.json'), 'utf-8')).toBe(stateBefore);
	});

	it('rejects a bogus --strategy value', () => {
		scaffold(tmp);
		const result = run(['update', '--yes', '--strategy', 'coinflip'], tmp);
		expect(result.status).toBe(1);
		expect(result.stderr).toContain('--strategy');
	});
});
