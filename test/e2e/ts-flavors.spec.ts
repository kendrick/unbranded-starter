import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PKG_ROOT } from '../../src/util/paths';

// #117: core-typescript's tsFlavor option decides whether the DOM lib types ship. The
// dry-run half reads the plan a consumer sees before anything is written; the
// real-install half scaffolds a preset and runs the scaffold's own tsc on a file that
// references `document`, because only the compiler can say whether the lib reached it.
const CLI = join(PKG_ROOT, 'dist/cli.js');

function dryRun(
	units: string,
	cwd: string,
	extra: string[] = [],
): { status: number | null; stdout: string; stderr: string } {
	const res = spawnSync('node', [CLI, '--dry-run', '--units', units, '--pm', 'pnpm', ...extra], {
		cwd,
		encoding: 'utf-8',
	});
	return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

describe('tsFlavor inline selection (#117)', () => {
	let tmp: string;
	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-e2e-ts-flavor-dry-'));
		// Without a package.json the CLI is in new-project mode and prompts for a name.
		writeFileSync(
			join(tmp, 'package.json'),
			JSON.stringify({ name: 'ts-flavor', version: '0.0.0' }, null, 2),
		);
	});
	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	// A dry run lists a created file's path but not its content, so the tsconfig half is
	// read off a real write with no install (pm null); the plan half reads the dry-run JSON.
	function scaffolded(units: string): { typescript?: string; base: string } {
		const json = dryRun(units, tmp, ['--json']);
		expect(json.status, json.stderr).toBe(0);

		writeFileSync(
			join(tmp, 'recipe.json'),
			JSON.stringify({
				units: ['core-typescript'],
				pm: null,
				onConflict: 'overwrite',
				postInstall: 'none',
			}),
		);
		const run = spawnSync('node', [CLI, '--config', 'recipe.json', '--units', units], {
			cwd: tmp,
			encoding: 'utf-8',
		});
		expect(run.status, run.stderr).toBe(0);

		return {
			typescript: (JSON.parse(json.stdout) as { devDependencies?: Record<string, string> })
				.devDependencies?.typescript,
			base: readFileSync(join(tmp, 'tsconfig.base.json'), 'utf-8'),
		};
	}

	it('core-typescript:6:dom plans typescript 6.0.3 and a tsconfig.base.json with DOM', () => {
		const p = scaffolded('core-typescript:6:dom');
		expect(p.typescript).toBe('6.0.3');
		expect(p.base).toContain('"DOM"');
	});

	it('core-typescript:6 plans typescript 6.0.3 and a tsconfig.base.json without DOM', () => {
		const p = scaffolded('core-typescript:6');
		expect(p.typescript).toBe('6.0.3');
		expect(p.base).toContain('"lib"');
		expect(p.base).not.toContain('"DOM"');
	});

	it('refuses a value no option of core-typescript has', () => {
		const r = dryRun('core-typescript:8', tmp, ['--json']);
		expect(r.status).not.toBe(0);
		expect(r.stderr).toContain('--units: core-typescript has no option value "8"');
		expect(r.stderr).toContain('typescriptLine must be one of: 6, 7');
		expect(r.stderr).toContain('tsFlavor must be one of: dom, node');
	});

	it('refuses two values for the same option', () => {
		const r = dryRun('core-typescript:6:7', tmp, ['--json']);
		expect(r.status).not.toBe(0);
		expect(r.stderr).toContain(
			'--units: core-typescript has typescriptLine given twice ("6" and "7").',
		);
	});
});

// UB_E2E_LEG=main skips the real-install half so the fast non-flavor e2e leg doesn't
// pay for two installs; a dedicated CI job runs this file by path.
describe.skipIf(process.env.UB_E2E_LEG === 'main')(
	'core-typescript flavors typecheck a DOM reference (e2e, real install)',
	() => {
		let tmp: string;

		beforeEach(() => {
			tmp = mkdtempSync(join(tmpdir(), 'unbranded-e2e-ts-flavor-'));
			// Seeded so the run takes the augment path instead of prompting for a name.
			writeFileSync(
				join(tmp, 'package.json'),
				JSON.stringify({ name: 'ts-flavor', version: '0.0.0' }, null, 2),
			);
		});

		afterEach(() => {
			rmSync(tmp, { recursive: true, force: true });
		});

		function scaffoldPreset(preset: string, extraFiles: Record<string, string> = {}): string {
			const run = spawnSync(
				'node',
				[CLI, '--preset', preset, '--pm', 'pnpm', '--yes', '--post-install', 'none'],
				{ cwd: tmp, encoding: 'utf-8' },
			);
			expect(run.status, `scaffold stderr: ${run.stderr}`).toBe(0);

			mkdirSync(join(tmp, 'src'), { recursive: true });
			writeFileSync(join(tmp, 'src', 'index.ts'), 'export const t = document.title;\n');
			for (const [path, content] of Object.entries(extraFiles)) {
				writeFileSync(join(tmp, path), content);
			}

			// node on the tsc JS entry (not the .bin shim) stays portable to windows CI.
			const tsc = spawnSync(
				'node',
				[join(tmp, 'node_modules', 'typescript', 'bin', 'tsc'), '--noEmit', '--pretty', 'false'],
				{ cwd: tmp, encoding: 'utf-8' },
			);
			// A spawn error or a node-level crash (missing module) leaves tsc.status null or
			// 1 with no `error TSxxxx` line, which a path filter alone would read as clean.
			const spawnError = tsc.error ? `SPAWNERROR ${tsc.error.message}\n` : '';
			return `${spawnError}${tsc.status === 0 ? 'EXIT0' : 'EXITNONZERO'}\n${tsc.stdout}\n${tsc.stderr}`;
		}

		// Proves the compiler checked the scaffold: it exited 0, or it reported
		// at least one diagnostic, and none of them is a config-level TS5xxx/TS6xxx error
		// (bad tsconfig, unknown option), which prints no file path.
		function expectTscRan(out: string): void {
			expect(out, out).not.toContain('SPAWNERROR');
			expect(out, out).not.toMatch(/error TS[56]\d{3}/);
			expect(out, out).toMatch(/EXIT0|error TS\d{4}/);
		}

		it('the cli preset (node flavor) fails tsc on a file referencing document', () => {
			const out = scaffoldPreset('cli');
			expect(out, out).toContain('EXITNONZERO');
			expect(out, out).toMatch(/src[\\/]index\.ts.*Cannot find name 'document'/);
		});

		it('the next-app preset (dom flavor) reports no error for that same file', () => {
			// Filtered by path: the rest of a next-app scaffold may not typecheck before its
			// own install steps, but nothing may be reported against src/index.ts.
			const out = scaffoldPreset('next-app');
			expectTscRan(out);
			expect(out, out).not.toMatch(/src[\\/]index\.ts/);
		});

		// #121: the node flavor alone sets exactOptionalPropertyTypes, so passing `undefined` to an optional property is an error in a cli scaffold and fine in a next-app one.
		const OPTIONAL_PROBE = {
			'src/optional.ts':
				'export function f(o: { a?: string }) { return o; }\nf({ a: undefined });\n',
		};

		it('the cli preset (node flavor) fails tsc on undefined passed to an optional property', () => {
			const out = scaffoldPreset('cli', OPTIONAL_PROBE);
			expect(out, out).toContain('EXITNONZERO');
			expect(out, out).toMatch(/src[\\/]optional\.ts.*exactOptionalPropertyTypes/);
		});

		it('the next-app preset (dom flavor) accepts undefined passed to an optional property', () => {
			const out = scaffoldPreset('next-app', OPTIONAL_PROBE);
			expectTscRan(out);
			expect(out, out).not.toMatch(/src[\\/]optional\.ts/);
		});
	},
);
