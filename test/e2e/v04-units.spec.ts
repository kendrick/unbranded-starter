import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PKG_ROOT } from '../../src/util/paths';

// The three mundane-pain units (#22) are unit-tested at the generation layer;
// this drives them through a real `--config` run so the copy dispatch, the
// merge-json fold, and the computed extensions.json are covered end to end.
const CLI = join(PKG_ROOT, 'dist/cli.js');

function writeJson(path: string, obj: unknown): void {
	writeFileSync(path, JSON.stringify(obj, null, 2));
}

// pm:null skips install, so a scaffold run is offline and fast. --config skips
// the Apply confirm, so no stdin is needed.
function scaffold(tmp: string, units: string[], onConflict: 'overwrite' | 'skip' = 'overwrite'): void {
	writeJson(join(tmp, 'package.json'), { name: 'v04-units', version: '0.0.0' });
	writeJson(join(tmp, 'recipe.json'), { units, pm: null, onConflict, postInstall: 'none' });
	const result = spawnSync('node', [CLI, '--config', 'recipe.json'], { cwd: tmp, encoding: 'utf-8' });
	expect(result.status, `stderr: ${result.stderr}`).toBe(0);
}

describe('v0.4 mundane-pain units (e2e)', () => {
	let tmp: string;

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-e2e-v04-'));
	});

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	it('core-gitattributes writes a .gitattributes that normalizes line endings', () => {
		scaffold(tmp, ['core-gitattributes']);
		const ga = readFileSync(join(tmp, '.gitattributes'), 'utf-8');
		expect(ga).toContain('* text=auto eol=lf');
		// Lockfiles marked out of diffs is the other half of the point.
		expect(ga).toContain('pnpm-lock.yaml -diff');
	});

	it('opt-vscode folds settings.json into an existing file, keeping user keys', () => {
		mkdirSync(join(tmp, '.vscode'), { recursive: true });
		writeJson(join(tmp, '.vscode', 'settings.json'), {
			'editor.rulers': [100],
			'editor.formatOnSave': false,
		});
		scaffold(tmp, ['opt-vscode']);

		const settings = JSON.parse(readFileSync(join(tmp, '.vscode', 'settings.json'), 'utf-8'));
		// A key only the user has survives the merge untouched.
		expect(settings['editor.rulers']).toEqual([100]);
		// A template-only key lands; the formatOnSave clash resolves to overwrite.
		expect(settings['editor.insertSpaces']).toBe(false);
		expect(settings['editor.formatOnSave']).toBe(true);
	});

	it('opt-vscode generates extensions.json from the selection, unioning what exists', () => {
		mkdirSync(join(tmp, '.vscode'), { recursive: true });
		writeJson(join(tmp, '.vscode', 'extensions.json'), {
			recommendations: ['acme.custom'],
			unwantedRecommendations: ['bad.ext'],
		});
		// core-editorconfig contributes editorconfig.editorconfig to the set.
		scaffold(tmp, ['opt-vscode', 'core-editorconfig']);

		const ext = JSON.parse(readFileSync(join(tmp, '.vscode', 'extensions.json'), 'utf-8'));
		expect(ext.recommendations).toContain('acme.custom'); // existing kept
		expect(ext.recommendations).toContain('editorconfig.editorconfig'); // tracks selection
		expect(ext.unwantedRecommendations).toEqual(['bad.ext']); // sibling key survives
	});

	it('opt-ci-github writes a workflow with the four scripts and no CLI-internal bits', () => {
		scaffold(tmp, ['opt-ci-github']);
		const wf = readFileSync(join(tmp, '.github', 'workflows', 'ci.yml'), 'utf-8');
		// Assert against the executable body, not the header comment — the comment
		// legitimately names the matrix and create-unbranded step it dropped.
		const body = wf.split('\n').filter(line => !line.trimStart().startsWith('#')).join('\n');
		expect(body).toMatch(/^name:/m);
		expect(body).toMatch(/^jobs:/m);
		for (const step of ['pnpm install', 'pnpm lint', 'pnpm typecheck', 'pnpm test'])
			expect(body).toContain(step);
		// The matrix and create-unbranded smoke are this repo's own; they must not
		// leak into a scaffolded workflow.
		expect(body).not.toMatch(/create-unbranded/);
		expect(body).not.toMatch(/matrix|strategy/);
	});

	it('opt-ci-github pulls in the units its workflow depends on', () => {
		scaffold(tmp, ['opt-ci-github']);
		// implies core-eslint (→ core-typescript), core-vitest, core-node-version, so
		// the lint/typecheck/test scripts and the pm pin the workflow calls exist.
		expect(existsSync(join(tmp, 'eslint.config.mjs'))).toBe(true);
		expect(existsSync(join(tmp, 'vitest.config.ts'))).toBe(true);
		expect(existsSync(join(tmp, '.nvmrc'))).toBe(true);
		const pkg = JSON.parse(readFileSync(join(tmp, 'package.json'), 'utf-8'));
		expect(pkg.scripts).toMatchObject({ lint: expect.any(String), typecheck: expect.any(String), test: expect.any(String) });
	});
});
