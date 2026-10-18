import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PKG_ROOT } from '../../src/util/paths';

// #182: oxfmt and oxlint walk the project root, so the baseline copies under
// .unbranded/baseline/ got formatted and linted as if they were project sources. A
// copy named `.oxfmtrc.json` even became a nested config. The `.base` suffix takes
// them out of both tools' file-type matching; this spec runs the real tools to prove
// it, since a unit test can only check the name.
const CLI = join(PKG_ROOT, 'dist/cli.js');
const FLAVORS = ['base', 'react', 'next'] as const;

function run(cmd: string, args: string[], cwd: string) {
	const res = spawnSync(cmd, args, {
		cwd,
		encoding: 'utf-8',
		env: { ...process.env, CI: 'true' },
		shell: process.platform === 'win32',
	});
	return { status: res.status, output: `${res.stdout}\n${res.stderr}` };
}

function scaffold(dir: string, units: string): void {
	writeFileSync(
		join(dir, 'package.json'),
		JSON.stringify({ name: 'sidecar-baseline', version: '0.0.0', private: true }, null, 2),
	);
	const res = spawnSync('node', [CLI, '--target', dir, '--units', units, '--pm', 'pnpm', '--yes'], {
		encoding: 'utf-8',
	});
	expect(res.status, `scaffold stdout: ${res.stdout}\nstderr: ${res.stderr}`).toBe(0);
}

// Every file under .unbranded/ keyed by its slash-normalised relative path, so a file
// that appears or vanishes shows up as a key difference and not just a changed hash.
function hashTree(dir: string): Record<string, string> {
	const root = join(dir, '.unbranded');
	const out: Record<string, string> = {};
	const walk = (current: string): void => {
		for (const entry of readdirSync(current, { withFileTypes: true })) {
			const full = join(current, entry.name);
			if (entry.isDirectory()) {
				walk(full);
			} else {
				out[relative(root, full).split(sep).join('/')] = createHash('sha256')
					.update(readFileSync(full))
					.digest('hex');
			}
		}
	};
	walk(root);
	return out;
}

// UB_E2E_LEG=main skips this real-install spec so the fast non-flavor e2e leg
// doesn't pay for the install; a dedicated CI job runs it by path.
describe.skipIf(process.env.UB_E2E_LEG === 'main')(
	'the baseline sidecar is invisible to oxfmt and oxlint (e2e, real install)',
	() => {
		let tmp: string;

		beforeEach(() => {
			tmp = mkdtempSync(join(tmpdir(), 'unbranded-e2e-sidecar-baseline-'));
		});

		afterEach(() => {
			rmSync(tmp, { recursive: true, force: true });
		});

		for (const flavor of FLAVORS) {
			it(`leaves .unbranded/ byte-identical through pnpm format and lints clean (${flavor})`, () => {
				scaffold(tmp, `core-oxlint:${flavor}`);

				// A misformatted file and a lint offender under the baseline: if either tool
				// reaches into the sidecar, the first gets rewritten and the second is reported.
				const misformatted = join(tmp, '.unbranded', 'baseline', 'a.ts');
				writeFileSync(misformatted, 'const   x =1\n');
				writeFileSync(join(tmp, '.unbranded', 'baseline', 'b.ts'), 'debugger;\n');

				const before = hashTree(tmp);
				expect(Object.keys(before), 'baseline should hold the seeded files').toEqual(
					expect.arrayContaining(['baseline/a.ts', 'baseline/b.ts']),
				);

				const format = run('pnpm', ['format'], tmp);
				expect(format.status, `pnpm format:\n${format.output}`).toBe(0);

				expect(hashTree(tmp)).toEqual(before);
				expect(readFileSync(misformatted, 'utf-8')).toBe('const   x =1\n');

				const lint = run('pnpm', ['lint'], tmp);
				expect(lint.status, `pnpm lint:\n${lint.output}`).toBe(0);
				expect(lint.output).not.toContain('.unbranded');
			});
		}

		// The issue saw both of these rewritten under their old names, so pin them by name.
		it('leaves the vitest config and oxlint config copies untouched (core-oxlint + core-vitest)', () => {
			scaffold(tmp, 'core-oxlint,core-vitest');

			const before = hashTree(tmp);
			for (const rel of ['baseline/vitest.config.ts.base', 'baseline/.oxlintrc.json.base']) {
				expect(Object.keys(before), `${rel} should be in the baseline`).toContain(rel);
			}

			const format = run('pnpm', ['format'], tmp);
			expect(format.status, `pnpm format:\n${format.output}`).toBe(0);

			expect(hashTree(tmp)).toEqual(before);
		});
	},
);
