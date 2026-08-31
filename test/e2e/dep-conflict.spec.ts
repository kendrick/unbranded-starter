import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { UNITS } from '../../src/manifest/index';
import { PKG_ROOT } from '../../src/util/paths';

const CLI = join(PKG_ROOT, 'dist/cli.js');
// Read the pinned versions from the manifest, not literals, so a weekly
// pin-bump PR doesn't redden this file every time a pin moves.
const CORE_TYPESCRIPT = UNITS.find(u => u.id === 'core-typescript');
const TYPESCRIPT_PIN = CORE_TYPESCRIPT?.devDependencies?.typescript;
const TYPES_NODE_PIN = CORE_TYPESCRIPT?.devDependencies?.['@types/node'];
if (!TYPESCRIPT_PIN || !TYPES_NODE_PIN)
	throw new Error('core-typescript manifest shape changed—update this test\'s pin lookups.');

// Escape a pin for use inside a RegExp—a pin is dotted (e.g. "5.9.3"), and
// an unescaped "." would match any character instead of a literal dot.
function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
const TYPESCRIPT_PIN_RE = escapeRegExp(TYPESCRIPT_PIN);

function writeJson(path: string, obj: unknown): void {
	writeFileSync(path, JSON.stringify(obj, null, 2));
}

// The seeded conflicting spec from #113's own repro: a project pinned a major
// back of what core-typescript ships.
const CONFLICTING_SPEC = '^6.0.3';

describe('cli dependency conflict resolution (#113)', () => {
	let tmp: string;

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-e2e-dep-conflict-'));
		writeJson(join(tmp, 'package.json'), {
			name: 'test-project',
			version: '0.0.0',
			devDependencies: { typescript: CONFLICTING_SPEC },
		});
	});

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	it('overwrite: takes the manifest pin and reports the collision', () => {
		writeJson(join(tmp, 'recipe.json'), {
			units: ['core-typescript'],
			pm: null,
			onConflict: 'overwrite',
			postInstall: 'none',
		});

		const result = spawnSync('node', [CLI, '--config', 'recipe.json'], {
			cwd: tmp,
			encoding: 'utf-8',
		});

		expect(result.status, `stderr: ${result.stderr}`).toBe(0);

		// This is the #113 repro itself: before the fix, the manifest pin won
		// silently and nothing on stdout said so. Now it wins but is reported.
		const pkg = JSON.parse(readFileSync(join(tmp, 'package.json'), 'utf-8')) as {
			devDependencies: Record<string, string>;
		};
		expect(pkg.devDependencies.typescript).toBe(TYPESCRIPT_PIN);

		expect(result.stdout).toMatch(/package\.json dependency conflicts/);
		expect(result.stdout).toMatch(
			new RegExp(`overwrote\\s+devDependencies\\.typescript\\s+\\^6\\.0\\.3\\s+->\\s+${TYPESCRIPT_PIN_RE}`),
		);
	});

	it('skip: keeps the user\'s spec, and the resolution doesn\'t cascade to sibling deps', () => {
		writeJson(join(tmp, 'recipe.json'), {
			units: ['core-typescript'],
			pm: null,
			onConflict: 'skip',
			postInstall: 'none',
		});

		const result = spawnSync('node', [CLI, '--config', 'recipe.json'], {
			cwd: tmp,
			encoding: 'utf-8',
		});

		expect(result.status, `stderr: ${result.stderr}`).toBe(0);

		const pkg = JSON.parse(readFileSync(join(tmp, 'package.json'), 'utf-8')) as {
			devDependencies: Record<string, string>;
		};
		expect(pkg.devDependencies.typescript).toBe(CONFLICTING_SPEC);
		// keepExisting scopes to the one colliding key (fs/merge-json's
		// mergeDepLike), so @types/node—the other half of core-typescript's
		// deps, which never collided—still lands at its manifest pin.
		expect(pkg.devDependencies['@types/node']).toBe(TYPES_NODE_PIN);

		expect(result.stdout).toMatch(
			new RegExp(`kept\\s+devDependencies\\.typescript\\s+\\^6\\.0\\.3\\s+\\(manifest pins\\s+${TYPESCRIPT_PIN_RE}\\)`),
		);
		expect(result.stdout).toMatch(/Kept pins may not match/);
	});

	// All three shipped presets set onConflict: 'skip', so a preset run keeps the
	// specs a repo already has rather than taking the manifest's pins. That
	// coupling is deliberate: a preset is the safe augment path, and #113 came
	// from a site pinned ahead of the manifest. Nothing else asserts it.
	it('preset: keeps the existing spec, because the shipped presets skip', () => {
		const result = spawnSync('node', [CLI, '--preset', 'node-lib'], {
			cwd: tmp,
			encoding: 'utf-8',
		});

		expect(result.status, `stderr: ${result.stderr}`).toBe(0);

		const pkg = JSON.parse(readFileSync(join(tmp, 'package.json'), 'utf-8')) as {
			devDependencies: Record<string, string>;
		};
		expect(pkg.devDependencies.typescript).toBe(CONFLICTING_SPEC);
		expect(result.stdout).toMatch(/kept\s+devDependencies\.typescript/);
	});

	it('--latest: never prompts, and rewrites the conflicting spec to \'latest\'', () => {
		// onConflict is a required recipe field, but --latest bypasses
		// resolveDepConflict entirely (writeAndInstall short-circuits to
		// 'overwrite' before it would ever prompt), so its value here doesn't
		// steer the outcome; it's set only to satisfy the schema.
		writeJson(join(tmp, 'recipe.json'), {
			units: ['core-typescript'],
			pm: null,
			onConflict: 'overwrite',
			postInstall: 'none',
		});

		// pm:null (via the recipe) keeps this non-interactive without a real
		// install; --latest and --yes ride in as actual CLI flags so this run
		// exercises the flag path #122 was filed about, not just recipe fields.
		const result = spawnSync('node', [CLI, '--config', 'recipe.json', '--latest', '--yes'], {
			cwd: tmp,
			encoding: 'utf-8',
		});

		// A nonzero exit (or a hang caught by the suite timeout) here would mean
		// an interactive picker leaked into a non-interactive run—#122.
		expect(result.status, `stderr: ${result.stderr}`).toBe(0);

		const pkg = JSON.parse(readFileSync(join(tmp, 'package.json'), 'utf-8')) as {
			devDependencies: Record<string, string>;
		};
		expect(pkg.devDependencies.typescript).toBe('latest');

		expect(result.stdout).toMatch(/--latest:\s+rewrote\s+1\s+existing dependency spec\(s\)\s+to\s+'latest'/);
	});
});
