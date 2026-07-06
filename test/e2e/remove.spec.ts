import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PKG_ROOT } from '../../src/util/paths';

const CLI = join(PKG_ROOT, 'dist/cli.js');

// opt-shadcn implies core-tailwind, so one recipe line installs a real
// dependency chain: shadcn's clsx/tailwind-merge plus tailwind's own deps land
// in package.json (pm: null keeps it install-free). That chain is the whole
// test bed — removal must respect both the dependents edge and the ref-count.
function scaffold(tmp: string): void {
	writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'remove-me', version: '0.0.0' }, null, 2));
	writeFileSync(join(tmp, 'recipe.json'), JSON.stringify({
		units: ['opt-shadcn'],
		pm: null,
		onConflict: 'overwrite',
		postInstall: 'none',
	}, null, 2));
	const applied = spawnSync('node', [CLI, '--config', 'recipe.json'], { cwd: tmp, encoding: 'utf-8' });
	expect(applied.status, `scaffold stderr: ${applied.stderr}`).toBe(0);
}

function run(args: string[], cwd: string): ReturnType<typeof spawnSync<string>> {
	return spawnSync('node', [CLI, ...args], { cwd, encoding: 'utf-8' });
}

function pkg(tmp: string): { dependencies?: Record<string, string>; devDependencies?: Record<string, string> } {
	return JSON.parse(readFileSync(join(tmp, 'package.json'), 'utf-8')) as ReturnType<typeof pkg>;
}

describe('unbranded remove', () => {
	let tmp: string;

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-e2e-remove-'));
	});

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	it('removes a unit but leaves the dep a remaining unit still claims', () => {
		scaffold(tmp);
		expect(pkg(tmp).dependencies?.clsx).toBeDefined();

		const result = run(['remove', 'opt-shadcn', '--yes'], tmp);
		expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);

		// shadcn's own files and sole-owned deps go…
		expect(existsSync(join(tmp, 'components.json'))).toBe(false);
		expect(existsSync(join(tmp, 'src', 'lib', 'utils.ts'))).toBe(false);
		expect(pkg(tmp).dependencies).toBeUndefined();
		// …but tailwindcss survives: core-tailwind is still installed and claims it.
		expect(pkg(tmp).devDependencies?.tailwindcss).toBeDefined();

		const state = JSON.parse(readFileSync(join(tmp, '.unbranded.json'), 'utf-8')) as { units: string[] };
		expect(state.units).toEqual(['core-tailwind']);
	});

	it('refuses to strand a dependent, then removes the closure under --cascade', () => {
		scaffold(tmp);

		const refused = run(['remove', 'core-tailwind', '--yes'], tmp);
		expect(refused.status).toBe(1);
		expect(refused.stderr).toContain('opt-shadcn');
		expect(refused.stderr).toContain('--cascade');
		expect(existsSync(join(tmp, 'components.json'))).toBe(true);

		const cascaded = run(['remove', 'core-tailwind', '--cascade', '--yes'], tmp);
		expect(cascaded.status, cascaded.stderr).toBe(0);
		expect(existsSync(join(tmp, 'components.json'))).toBe(false);
		// Nothing tracked anymore: the envelope and sidecar leave with the last unit.
		expect(existsSync(join(tmp, '.unbranded.json'))).toBe(false);
		expect(existsSync(join(tmp, '.unbranded'))).toBe(false);
	});

	it('previews with --dry-run and changes nothing', () => {
		scaffold(tmp);
		const before = readFileSync(join(tmp, '.unbranded.json'), 'utf-8');

		const result = run(['remove', 'opt-shadcn', '--dry-run'], tmp);
		expect(result.status, result.stderr).toBe(0);
		expect(result.stdout).toContain('components.json');

		expect(existsSync(join(tmp, 'components.json'))).toBe(true);
		expect(readFileSync(join(tmp, '.unbranded.json'), 'utf-8')).toBe(before);
	});

	it('exits 1 for an untracked unit and for a bare `remove` with no id', () => {
		scaffold(tmp);
		expect(run(['remove', 'core-vitest', '--yes'], tmp).status).toBe(1);
		expect(run(['remove'], tmp).status).toBe(1);
	});
});
