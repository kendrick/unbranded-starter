import type { AddressInfo } from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { collectManifestPins } from '../../src/commands/outdated';
import { UNITS } from '../../src/manifest/index';
import { PKG_ROOT } from '../../src/util/paths';

const CLI = join(PKG_ROOT, 'dist/cli.js');

function run(args: string[], cwd: string): ReturnType<typeof spawnSync<string>> {
	return spawnSync('node', [CLI, ...args], { cwd, encoding: 'utf-8' });
}

// The shipped schemas must accept what the shipped CLI actually emits — this
// compile step plus the validations below are the contract's regression test.
const ajv = new Ajv2020({ allErrors: true });
function validator(name: string) {
	return ajv.compile(JSON.parse(readFileSync(join(PKG_ROOT, 'schemas', `${name}.schema.json`), 'utf-8')));
}

function expectValid(name: string, payload: unknown): void {
	const validate = validator(name);
	expect(validate(payload), JSON.stringify(validate.errors, null, 2)).toBe(true);
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

describe('the shipped schemas accept live CLI output', () => {
	let tmp: string;

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-e2e-contract-'));
		writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'contract', version: '0.0.0' }, null, 2));
	});

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	// One scaffold covers every tracked mode: copy, merge-json, two computed.
	function scaffold(): Record<string, unknown> {
		const recipe = {
			units: ['core-editorconfig', 'opt-vscode', 'core-node-version'],
			pm: null,
			onConflict: 'overwrite',
			postInstall: 'none',
		};
		writeFileSync(join(tmp, 'recipe.json'), JSON.stringify(recipe, null, 2));
		const applied = run(['--config', 'recipe.json'], tmp);
		expect(applied.status, applied.stderr).toBe(0);
		return recipe;
	}

	it('catalog: list --json', () => {
		const result = run(['list', '--json'], tmp);
		expect(result.status).toBe(0);
		expectValid('catalog', JSON.parse(result.stdout));
	});

	it('plan: --dry-run --json', () => {
		const result = run(['--dry-run', '--json', '--units', 'opt-shadcn', '--pm', 'npm'], tmp);
		expect(result.status, result.stderr).toBe(0);
		expectValid('plan', JSON.parse(result.stdout));
	});

	it('recipe, state, diff, doctor: the whole scaffold loop', () => {
		const recipe = scaffold();
		expectValid('recipe', recipe);
		expectValid('state', JSON.parse(readFileSync(join(tmp, '.unbranded.json'), 'utf-8')));

		const diff = run(['diff', '--json'], tmp);
		expect(diff.status, diff.stdout).toBe(0);
		expectValid('diff', JSON.parse(diff.stdout));

		const doctor = run(['doctor', '--json'], tmp);
		expect(doctor.status).toBe(0);
		expectValid('doctor', JSON.parse(doctor.stdout));
	});

	it('outdated: against a local echo registry', async () => {
		// Same in-process registry trick as the outdated e2e, so the envelope
		// being validated came off a real network round trip.
		const pins = new Map(collectManifestPins(UNITS).map(p => [p.name, p.pin]));
		const server = createServer((req, res) => {
			const name = decodeURIComponent((req.url ?? '/').slice(1));
			res.setHeader('content-type', 'application/json');
			res.end(JSON.stringify({ 'dist-tags': { latest: pins.get(name) ?? '0.0.0' } }));
		});
		await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
		const registry = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

		try {
			const result = await new Promise<{ status: number | null; stdout: string }>((resolve) => {
				const child = spawn('node', [CLI, 'outdated', '--json', '--registry', registry], { cwd: tmp });
				let stdout = '';
				child.stdout.on('data', (d: Buffer) => {
					stdout += d.toString();
				});
				child.on('close', status => resolve({ status, stdout }));
			});
			expect(result.status).toBe(0);
			expectValid('outdated', JSON.parse(result.stdout));
		}
		finally {
			await new Promise(resolve => server.close(resolve));
		}
	});
});
