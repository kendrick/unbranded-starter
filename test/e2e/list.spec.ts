import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PKG_ROOT } from '../../src/util/paths';

const CLI = join(PKG_ROOT, 'dist/cli.js');

interface Catalog {
	schema: number;
	units: {
		id: string;
		label: string;
		files: { dest: string }[];
		excludes?: string[];
		impliesOneOf?: { anyOf: string[]; fallback: string };
		options?: { key: string; default: string; choices: { value: string }[] }[];
	}[];
}

describe('unbranded list', () => {
	let tmp: string;

	beforeEach(() => {
		// An empty temp dir with no package.json proves `list` needs no target.
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-e2e-list-'));
	});

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	it('prints the grouped catalog anywhere, no TTY or target project needed', () => {
		const result = spawnSync('node', [CLI, 'list'], { cwd: tmp, encoding: 'utf-8' });
		expect(result.status, `stderr: ${result.stderr}`).toBe(0);
		expect(result.stdout).toContain('Foundation');
		expect(result.stdout).toContain('core-eslint');
		expect(result.stdout).toMatch(/implies → core-typescript/);
		// #175: the lint unit opt-ci-github adds comes from a slot, not `implies`.
		const ciLine = result.stdout.split('\n').find((l) => l.includes('opt-ci-github'));
		expect(ciLine).toContain('one of core-eslint, core-oxlint, default core-oxlint');
	});

	it('emits stable, versioned JSON with --json and never leaks internal src paths', () => {
		const result = spawnSync('node', [CLI, 'list', '--json'], { cwd: tmp, encoding: 'utf-8' });
		expect(result.status, `stderr: ${result.stderr}`).toBe(0);

		const parsed = JSON.parse(result.stdout) as Catalog;
		expect(parsed.schema).toBe(2);
		expect(parsed.units.length).toBeGreaterThan(0);
		expect(result.stdout).not.toContain('"src"');
		// The generated config is delivered inline per flavor; that content is an
		// internal payload and must not swell the catalog.
		expect(result.stdout).not.toContain('"content"');

		// core-eslint's config now varies by flavor, so it ships no static file —
		// the eslintFlavor option surfaces the choices instead.
		const eslint = parsed.units.find((u) => u.id === 'core-eslint');
		expect(eslint?.files).toEqual([]);
		const flavor = eslint?.options?.find((o) => o.key === 'eslintFlavor');
		expect(flavor?.default).toBe('base');
		expect(flavor?.choices.map((c) => c.value)).toEqual(['base', 'react', 'next']);

		// #157: the oxc lint unit surfaces its flavor the same way, and states which
		// unit it can't sit beside.
		const oxlint = parsed.units.find((u) => u.id === 'core-oxlint');
		const oxlintFlavor = oxlint?.options?.find((o) => o.key === 'oxlintFlavor');
		expect(oxlintFlavor?.default).toBe('base');
		expect(oxlintFlavor?.choices.map((c) => c.value)).toEqual(['base', 'react', 'next']);
		expect(oxlint?.excludes).toEqual(['core-eslint']);

		// #193: the TypeScript line is core-typescript's own option.
		const ts = parsed.units.find((u) => u.id === 'core-typescript');
		const tsLine = ts?.options?.find((o) => o.key === 'typescriptLine');
		expect(tsLine?.default).toBe('7');
		expect(tsLine?.choices.map((c) => c.value)).toEqual(['7', '6']);

		const ci = parsed.units.find((u) => u.id === 'opt-ci-github');
		expect(ci?.impliesOneOf).toEqual({
			anyOf: ['core-eslint', 'core-oxlint'],
			fallback: 'core-oxlint',
		});

		// Byte-for-byte determinism is the whole point of the versioned envelope.
		const again = spawnSync('node', [CLI, 'list', '--json'], { cwd: tmp, encoding: 'utf-8' });
		expect(again.stdout).toBe(result.stdout);
	});

	// #230: a pipe reader got only the first 64 KiB because the process exited with
	// the rest of stdout still queued. Needs a pack big enough to cross one pipe buffer.
	it('delivers --json output past 64 KiB through a pipe, same bytes as a file redirect', () => {
		for (let i = 1; i <= 1000; i++) {
			const dir = join(tmp, 'pack', `u${i}`);
			mkdirSync(dir, { recursive: true });
			writeFileSync(
				join(dir, 'unit.json'),
				JSON.stringify({
					schema: 1,
					id: `u${i}`,
					category: 'foundation',
					label: `Unit ${i}`,
					description: `Unit ${i}, one of a thousand.`,
					files: [],
				}),
			);
		}

		const piped = spawnSync('node', [CLI, 'list', '--json', '--units-dir', 'pack'], {
			cwd: tmp,
			encoding: 'utf-8',
			maxBuffer: 16 * 1024 * 1024,
			timeout: 60_000,
		});
		const redirected = join(tmp, 'list.json');
		const viaFile = spawnSync(
			'sh',
			['-c', `node "${CLI}" list --json --units-dir pack > list.json`],
			{
				cwd: tmp,
				encoding: 'utf-8',
				timeout: 60_000,
			},
		);

		expect(piped.status, `stderr: ${piped.stderr}`).toBe(0);
		expect(viaFile.status, `stderr: ${viaFile.stderr}`).toBe(0);
		const onDisk = readFileSync(redirected, 'utf-8');
		expect(onDisk.length).toBeGreaterThan(64 * 1024);
		expect(piped.stdout.length).toBe(onDisk.length);
		const parsed = JSON.parse(piped.stdout) as Catalog;
		expect(parsed.units.filter((u) => /^pack\/u\d+$/.test(u.id))).toHaveLength(1000);
	});

	it('mentions `unbranded list` in --help', () => {
		const result = spawnSync('node', [CLI, '--help'], { cwd: tmp, encoding: 'utf-8' });
		expect(result.status).toBe(0);
		expect(result.stdout).toContain('unbranded list');
	});
});
