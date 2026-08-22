import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PKG_ROOT } from '../../src/util/paths';

const CLI = join(PKG_ROOT, 'dist/cli.js');

function run(args: string[], cwd: string): ReturnType<typeof spawnSync<string>> {
	return spawnSync('node', [CLI, ...args], { cwd, encoding: 'utf-8' });
}

// The one containment case that genuinely needs its own process. A guard
// that captures `process.cwd()` at module load reads the same value
// whichever root a case passes it, and `process.chdir` afterwards moves
// nothing, so an in-process table can't tell that build apart from a correct
// one: both run in the same process at the same cwd. The in-process version
// of this case was written twice during review and came back green both
// times against exactly the build it was meant to catch. This spawns the
// CLI instead, from a working directory that is not the project root, and
// lives here rather than beside the unit specs because `pnpm test` doesn't
// build — a spawning case under src/**/*.spec.ts would either miss dist/cli.js
// or silently read a stale one, which is how a reverted guard looks fixed.
describe('containment: root-agnosticism (spawned)', () => {
	let tmp: string;

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-e2e-containment-'));
	});

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	it('rejects the same escaping unit identically from two different working directories', () => {
		const dir = join(tmp, 'evil');
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, 'unit.json'), JSON.stringify({
			schema: 1,
			id: 'unit-root-agnostic',
			category: 'editor',
			label: 'Escape probe',
			description: 'A unit whose rename escapes the project root.',
			files: [{ dest: 'ok.txt', content: 'pwned\n', rename: '../ESCAPED-e2e-root-agnostic.txt' }],
		}));

		// The unit path is absolute, so the CLI's own cwd is the only thing
		// varying between these two invocations. Neither cwd is the project
		// root the test runner itself started from — one is a fresh scratch
		// dir, the other is the filesystem root — which is what a
		// process.cwd()-rooted guard would answer differently for: from `/`
		// almost nothing resolves outside the (wrong) root, so an escaping
		// unit would validate clean.
		const fromScratchDir = run(['validate', dir], tmp);
		const fromFilesystemRoot = run(['validate', dir], '/');

		for (const result of [fromScratchDir, fromFilesystemRoot]) {
			expect(result.status).not.toBe(0);
			expect(result.stdout).toContain('ESCAPED-e2e-root-agnostic.txt');
		}
	});
});
