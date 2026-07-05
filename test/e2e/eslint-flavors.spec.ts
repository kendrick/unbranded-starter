import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PKG_ROOT } from '../../src/util/paths';

// F-02: core-eslint's flavors. The generation layer (buildEslintConfig,
// eslintDevDependencies, applyUnitOptions) is unit-tested; this drives each flavor
// through a real `--config` run with a real pnpm install, then lints the generated
// eslint.config.mjs with the flavor's own installed plugins. Linting the config
// file is what forces eslint to build the full config, so a missing plugin or an
// unresolved rule (e.g. base referencing pnpm/* rules) fails here. Full-project
// `eslint .` is a separate concern — the seeded package.json's key order and indent
// don't satisfy antfu's jsonc rules yet, which is orthogonal to flavors.
const CLI = join(PKG_ROOT, 'dist/cli.js');

interface Scaffold {
	dir: string;
	pkg: { devDependencies?: Record<string, string> };
	config: string;
}

function scaffoldFlavor(dir: string, flavor: 'base' | 'react' | 'next'): Scaffold {
	writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: `flavor-${flavor}`, version: '0.0.0', private: true }, null, 2));
	writeFileSync(join(dir, 'recipe.json'), JSON.stringify({
		units: ['core-eslint'],
		pm: 'pnpm',
		onConflict: 'overwrite',
		postInstall: 'none',
		options: { eslintFlavor: flavor },
	}, null, 2));

	const run = spawnSync('node', [CLI, '--config', 'recipe.json'], { cwd: dir, encoding: 'utf-8' });
	expect(run.status, `scaffold stderr: ${run.stderr}`).toBe(0);

	return {
		dir,
		pkg: JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8')),
		config: readFileSync(join(dir, 'eslint.config.mjs'), 'utf-8'),
	};
}

// Lint the generated config with the scaffold's own eslint. node on the eslint JS
// entry (not the .bin shim) keeps this portable to the windows-latest CI leg. CI=1
// forces the full ruleset — antfu relaxes some rules when it thinks it's in an editor.
function lintConfig(dir: string): { status: number | null; output: string } {
	const eslintJs = join(dir, 'node_modules', 'eslint', 'bin', 'eslint.js');
	const res = spawnSync('node', [eslintJs, 'eslint.config.mjs'], {
		cwd: dir,
		encoding: 'utf-8',
		env: { ...process.env, CI: 'true' },
	});
	return { status: res.status, output: `${res.stdout}\n${res.stderr}` };
}

describe('core-eslint flavors (e2e, real install)', () => {
	let tmp: string;

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-e2e-flavor-'));
	});

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	it('base installs zero React packages and its generated config lints clean', () => {
		const s = scaffoldFlavor(tmp, 'base');
		const dev = s.pkg.devDependencies ?? {};

		expect(dev).toHaveProperty('@antfu/eslint-config');
		expect(dev).toHaveProperty('eslint-plugin-format');
		for (const pkg of ['@eslint-react/eslint-plugin', 'eslint-plugin-jsx-a11y', 'eslint-plugin-react-refresh', '@next/eslint-plugin-next'])
			expect(dev, `base should not install ${pkg}`).not.toHaveProperty(pkg);

		expect(s.config).not.toContain('react: true');
		expect(s.config).not.toContain('nextjs: true');

		const lint = lintConfig(tmp);
		expect(lint.status, lint.output).toBe(0);
	});

	it('react adds the react plugins and jsx-a11y, and its config lints clean', () => {
		const s = scaffoldFlavor(tmp, 'react');
		const dev = s.pkg.devDependencies ?? {};

		expect(dev).toHaveProperty('@eslint-react/eslint-plugin');
		expect(dev).toHaveProperty('eslint-plugin-jsx-a11y');
		expect(dev).not.toHaveProperty('@next/eslint-plugin-next');

		expect(s.config).toContain('react: true,');
		expect(s.config).toContain('\'jsx-a11y/alt-text\': \'error\',');
		expect(s.config).not.toContain('nextjs: true');

		const lint = lintConfig(tmp);
		expect(lint.status, lint.output).toBe(0);
	});

	it('next adds the next plugin and rules, and its config lints clean', () => {
		const s = scaffoldFlavor(tmp, 'next');
		const dev = s.pkg.devDependencies ?? {};

		expect(dev).toHaveProperty('@next/eslint-plugin-next');
		expect(dev).toHaveProperty('@eslint-react/eslint-plugin');

		expect(s.config).toContain('nextjs: true,');
		expect(s.config).toContain('\'@next/next/no-img-element\': \'error\',');

		const lint = lintConfig(tmp);
		expect(lint.status, lint.output).toBe(0);
	});
});
