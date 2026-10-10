import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PKG_ROOT } from '../../src/util/paths';

// #160: opt-husky's lint-staged config follows the lint unit. The fast half
// scaffolds without installing and reads the generated file and `diff --json`;
// the slow half installs, wires husky, and commits a fixable file for real.
const CLI = join(PKG_ROOT, 'dist/cli.js');

function cli(args: string[], cwd: string) {
	return spawnSync('node', [CLI, ...args], { cwd, encoding: 'utf-8' });
}

function scaffoldNoInstall(dir: string, lint: string): string {
	writeFileSync(
		join(dir, 'package.json'),
		JSON.stringify({ name: 'staged', version: '0.0.0' }, null, 2),
	);
	writeFileSync(
		join(dir, 'recipe.json'),
		JSON.stringify({
			units: [lint, 'opt-husky'],
			pm: null,
			onConflict: 'overwrite',
			postInstall: 'none',
		}),
	);
	const run = cli(['--config', 'recipe.json'], dir);
	expect(run.status, run.stderr).toBe(0);
	return readFileSync(join(dir, 'lint-staged.config.mjs'), 'utf-8');
}

describe('opt-husky lint-staged config follows the lint unit (#160)', () => {
	let tmp: string;
	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-e2e-lint-staged-'));
	});
	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	it('core-oxlint names oxlint and oxfmt and never eslint, and diff --json reports no drift', () => {
		const config = scaffoldNoInstall(tmp, 'core-oxlint');
		expect(config).toContain('oxlint');
		expect(config).toContain('oxfmt');
		expect(config).not.toContain('eslint');
		const diff = cli(['diff', '--json'], tmp);
		expect(diff.status, `${diff.stdout}${diff.stderr}`).toBe(0);
	});

	it('core-eslint names eslint and never oxlint, and diff --json reports no drift', () => {
		const config = scaffoldNoInstall(tmp, 'core-eslint');
		expect(config).toContain('eslint');
		expect(config).not.toContain('oxlint');
		const diff = cli(['diff', '--json'], tmp);
		expect(diff.status, `${diff.stdout}${diff.stderr}`).toBe(0);
	});
});

describe.skipIf(process.env.UB_E2E_LEG === 'main' || process.platform === 'win32')(
	'opt-husky commit with core-oxlint (e2e, real install)',
	() => {
		let tmp: string;
		beforeEach(() => {
			tmp = mkdtempSync(join(tmpdir(), 'unbranded-e2e-lint-staged-commit-'));
		});
		afterEach(() => {
			rmSync(tmp, { recursive: true, force: true });
		});

		it('fixes a staged oxlint violation and commits the fixed bytes', () => {
			writeFileSync(
				join(tmp, 'package.json'),
				JSON.stringify({ name: 'staged-commit', version: '0.0.0', private: true }, null, 2),
			);
			const scaffold = cli(['--units', 'core-oxlint,opt-husky', '--pm', 'pnpm', '--yes'], tmp);
			expect(scaffold.status, `${scaffold.stdout}${scaffold.stderr}`).toBe(0);
			const config = readFileSync(join(tmp, 'lint-staged.config.mjs'), 'utf-8');
			expect(config).toContain('oxlint');
			expect(config).not.toContain('eslint');
			const diff = cli(['diff', '--json'], tmp);
			expect(diff.status, `${diff.stdout}${diff.stderr}`).toBe(0);

			const git = (...args: string[]) =>
				spawnSync('git', ['-c', 'user.name=e2e', '-c', 'user.email=e2e@example.com', ...args], {
					cwd: tmp,
					encoding: 'utf-8',
				});
			expect(git('init', '-q').status).toBe(0);
			// lint-staged needs a HEAD to diff against, so the scaffold lands first, unhooked.
			expect(git('add', '-A').status).toBe(0);
			expect(git('commit', '-q', '--no-verify', '-m', 'scaffold').status).toBe(0);
			const husky = spawnSync('pnpm', ['exec', 'husky'], { cwd: tmp, encoding: 'utf-8' });
			expect(husky.status, `${husky.stdout}${husky.stderr}`).toBe(0);

			mkdirSync(join(tmp, 'src'), { recursive: true });
			writeFileSync(join(tmp, 'src', 'a.ts'), 'export const a = (x: number[]) => [...[...x]];\n');
			expect(git('add', 'src/a.ts').status).toBe(0);
			const commit = git('commit', '-m', 'add a');
			expect(commit.status, `${commit.stdout}${commit.stderr}`).toBe(0);

			const committed = git('show', 'HEAD:src/a.ts').stdout;
			expect(committed).toContain('[...x]');
			expect(committed).not.toContain('[...[...x]]');
		});
	},
);
