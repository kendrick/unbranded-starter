import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PKG_ROOT } from '../../src/util/paths';

const CLI = join(PKG_ROOT, 'dist/cli.js');

function run(args: string[], cwd: string): ReturnType<typeof spawnSync<string>> {
	return spawnSync('node', [CLI, ...args], { cwd, encoding: 'utf-8' });
}

describe('--dry-run --json (the machine-readable plan)', () => {
	let tmp: string;

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-e2e-plan-json-'));
		writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'plan-me', version: '0.0.0' }, null, 2));
	});

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	it('emits pure JSON: the resolved units, the implied additions, and per-file verdicts', () => {
		const result = run(['--dry-run', '--json', '--units', 'opt-shadcn', '--pm', 'npm'], tmp);
		expect(result.status, `stderr: ${result.stderr}`).toBe(0);

		// The whole stdout must parse — one stray clack line breaks a consumer.
		const plan = JSON.parse(result.stdout) as {
			schema: number;
			target: { dir: string; mode: string };
			pm: string | null;
			units: string[];
			auto: string[];
			files: { path: string; action: string }[];
		};

		expect(plan.schema).toBe(1);
		expect(plan.target.mode).toBe('augment');
		expect(plan.pm).toBe('npm');
		// The resolver ran: shadcn drags tailwind in, and the plan says which
		// entries the user didn't pick themselves.
		expect(plan.units).toContain('opt-shadcn');
		expect(plan.units).toContain('core-tailwind');
		expect(plan.auto).toEqual(['core-tailwind']);
		expect(plan.files.find(f => f.path === 'components.json')?.action).toBe('create');
		// dest paths are posix in the envelope, whatever the host separator.
		expect(plan.files.find(f => f.path === 'src/lib/utils.ts')?.action).toBe('create');
	});

	it('classifies an already-identical file as skip', () => {
		copyFileSync(join(PKG_ROOT, '.editorconfig'), join(tmp, '.editorconfig'));
		const result = run(['--dry-run', '--json', '--units', 'core-editorconfig', '--pm', 'npm'], tmp);
		expect(result.status, result.stderr).toBe(0);
		const plan = JSON.parse(result.stdout) as { files: { path: string; action: string }[] };
		expect(plan.files.find(f => f.path === '.editorconfig')?.action).toBe('skip');
	});

	it('writes nothing, ever', () => {
		run(['--dry-run', '--json', '--units', 'core-editorconfig', '--pm', 'npm'], tmp);
		expect(run(['diff'], tmp).stdout).not.toContain('.editorconfig');
	});

	it('refuses to run without a selection: there is no picker to drive', () => {
		const result = run(['--dry-run', '--json'], tmp);
		expect(result.status).toBe(1);
		expect(result.stderr).toContain('--units');
	});
});
