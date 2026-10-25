import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PKG_ROOT } from '../../src/util/paths';

// #184: opt-vscode's lint keys follow the lint unit. Recipes use pm: null so
// nothing installs and every case runs on the main leg.
const CLI = join(PKG_ROOT, 'dist/cli.js');

// opt-in/vscode/settings.json at 3660e44, before the lint keys moved into the
// generator. A core-eslint scaffold has to keep it byte for byte.
const ESLINT_SETTINGS =
	'{\n\t"editor.formatOnSave": true,\n\t"editor.codeActionsOnSave": {\n\t\t"source.fixAll.eslint": "explicit",\n\t\t"source.fixAll.stylelint": "explicit"\n\t},\n\t"editor.defaultFormatter": "dbaeumer.vscode-eslint",\n\t"editor.insertSpaces": false,\n\t"eslint.useFlatConfig": true,\n\t"stylelint.validate": ["css", "postcss", "scss"],\n\t"[css]": {\n\t\t"editor.defaultFormatter": "stylelint.vscode-stylelint"\n\t},\n\t"typescript.tsdk": "node_modules/typescript/lib",\n\t"typescript.enablePromptUseWorkspaceTsdk": true,\n\t"search.exclude": {\n\t\t"**/node_modules": true,\n\t\t"**/dist": true\n\t}\n}\n';

function cli(args: string[], cwd: string) {
	return spawnSync('node', [CLI, ...args], { cwd, encoding: 'utf-8' });
}

function git(args: string[], cwd: string) {
	const r = spawnSync('git', ['-c', 'user.name=e2e', '-c', 'user.email=e2e@example.com', ...args], {
		cwd,
		encoding: 'utf-8',
	});
	expect(r.status, `git ${args.join(' ')}: ${r.stderr}`).toBe(0);
}

function seed(dir: string): void {
	writeFileSync(
		join(dir, 'package.json'),
		JSON.stringify({ name: 'vscode-lint', version: '0.0.0' }, null, 2),
	);
	git(['init', '-q'], dir);
}

function scaffold(dir: string, units: string[]): void {
	writeFileSync(
		join(dir, 'recipe.json'),
		JSON.stringify({
			units,
			pm: null,
			onConflict: 'overwrite',
			postInstall: 'none',
			projectName: '.',
		}),
	);
	const run = cli(['--config', 'recipe.json'], dir);
	expect(run.status, `${run.stdout}${run.stderr}`).toBe(0);
}

function settings(dir: string): string {
	return readFileSync(join(dir, '.vscode', 'settings.json'), 'utf-8');
}

function lintKeys(raw: string): Record<string, unknown> {
	const parsed = JSON.parse(raw) as Record<string, unknown>;
	const actions = (parsed['editor.codeActionsOnSave'] ?? {}) as Record<string, unknown>;
	const out: Record<string, unknown> = {
		'editor.defaultFormatter': parsed['editor.defaultFormatter'],
		'editor.codeActionsOnSave': actions,
	};
	for (const [key, value] of Object.entries(parsed)) {
		if (key.startsWith('eslint.')) out[key] = value;
	}
	return out;
}

describe('opt-vscode lint keys follow the lint unit (#184)', () => {
	let tmp: string;
	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-e2e-vscode-settings-'));
		seed(tmp);
	});
	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	it('core-oxlint names the oxc extension and never eslint', () => {
		scaffold(tmp, ['core-oxlint', 'opt-vscode']);
		const raw = settings(tmp);
		expect(raw).not.toMatch(/eslint/i);
		const parsed = JSON.parse(raw) as Record<string, unknown>;
		expect(parsed['editor.defaultFormatter']).toBe('oxc.oxc-vscode');
		const actions = parsed['editor.codeActionsOnSave'] as Record<string, unknown>;
		expect(actions['source.fixAll.oxc']).toBe('explicit');
	});

	it('core-eslint keeps the pre-#184 file byte for byte', () => {
		scaffold(tmp, ['core-eslint', 'opt-vscode']);
		expect(settings(tmp)).toBe(ESLINT_SETTINGS);
	});

	it('switching core-eslint to core-oxlint leaves the fresh core-oxlint lint keys', () => {
		const fresh = mkdtempSync(join(tmpdir(), 'unbranded-e2e-vscode-settings-fresh-'));
		try {
			seed(fresh);
			scaffold(fresh, ['core-oxlint', 'opt-vscode']);
			const expected = lintKeys(settings(fresh));

			scaffold(tmp, ['core-eslint', 'opt-vscode']);
			git(['add', '-A'], tmp);
			git(['commit', '-q', '-m', 'eslint'], tmp);
			const removed = cli(['remove', 'core-eslint', '--yes'], tmp);
			expect(removed.status, `${removed.stdout}${removed.stderr}`).toBe(0);
			git(['add', '-A'], tmp);
			git(['commit', '-q', '-m', 'remove eslint'], tmp);
			scaffold(tmp, ['core-oxlint', 'opt-vscode']);

			const actual = lintKeys(settings(tmp));
			expect(actual).toEqual(expected);
			expect(settings(tmp)).not.toMatch(/eslint/i);

			// A switch merges into the existing file, so its bytes never match the
			// generated content. diff once read that as drift `update` couldn't clear.
			const drift = cli(['diff', '--json'], tmp);
			expect(drift.status, `${drift.stdout}${drift.stderr}`).toBe(0);
		} finally {
			rmSync(fresh, { recursive: true, force: true });
		}
	});

	// The drift checker used to hash the raw catalog file, so a fresh scaffold
	// read template-updated for either lint unit and `update` could never clear it.
	it.each(['core-oxlint', 'core-eslint'])(
		'diff --json reads a fresh %s,opt-vscode scaffold as clean',
		(lint) => {
			scaffold(tmp, [lint, 'opt-vscode']);
			const run = cli(['diff', '--json'], tmp);
			expect(run.status, `${run.stdout}${run.stderr}`).toBe(0);
			const report = JSON.parse(run.stdout) as {
				drift: boolean;
				files: { path: string; status: string }[];
			};
			expect(report.drift).toBe(false);
			expect(report.files.find((f) => f.path === '.vscode/settings.json')?.status).toBe(
				'unchanged',
			);
		},
	);
});
