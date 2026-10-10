import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PKG_ROOT } from '../../src/util/paths';

// #157: core-oxlint's flavors through a real `--config` run and a real pnpm install,
// then the scaffold's own `pnpm lint` and `pnpm format`. oxlint drops a rule whose
// plugin isn't in `plugins` without saying so, so each plugin a flavor enables gets
// a probe carrying one known violation, and the run has to name that exact rule.
const CLI = join(PKG_ROOT, 'dist/cli.js');

type Flavor = 'base' | 'react' | 'next';
const ONLY_FLAVOR = process.env.UB_FLAVOR;
function flavorRuns(flavor: Flavor): boolean {
	return ONLY_FLAVOR === undefined || ONLY_FLAVOR === flavor;
}

interface OxlintConfig {
	plugins: string[];
}
interface PackageJson {
	devDependencies?: Record<string, string>;
}

// Keyed by the plugin name as .oxlintrc.json spells it. `reported` is the rule as
// oxlint prints it, which for the nextjs plugin is `next(...)`.
const PROBES: Record<string, { file: string; source: string; reported: string }> = {
	'eslint': {
		file: 'src/probe-eslint.ts',
		source: 'export function f(): void {\n\tdebugger;\n}\n',
		reported: 'eslint(no-debugger)',
	},
	'typescript': {
		file: 'src/probe-typescript.ts',
		source: 'export const f = (a?: { b: number }): number => a?.b!;\n',
		reported: 'typescript(no-non-null-asserted-optional-chain)',
	},
	'unicorn': {
		file: 'src/probe-unicorn.ts',
		source: 'export const x = { then() {} };\n',
		reported: 'unicorn(no-thenable)',
	},
	'oxc': {
		file: 'src/probe-oxc.ts',
		source: 'export const f = (a: number): boolean => a > 5 && a < 3;\n',
		reported: 'oxc(const-comparisons)',
	},
	'import': {
		file: 'src/probe-import.ts',
		source: "import './side-effect';\n",
		reported: 'import(no-unassigned-import)',
	},
	'react': {
		file: 'src/probe-react.tsx',
		source: 'export const L = () => <ul>{[1, 2].map((n) => <li>{n}</li>)}</ul>;\n',
		reported: 'react(jsx-key)',
	},
	'jsx-a11y': {
		file: 'src/probe-jsx-a11y.tsx',
		source: 'export const I = () => <img src="a.png" />;\n',
		reported: 'jsx-a11y(alt-text)',
	},
	'nextjs': {
		file: 'src/probe-nextjs.tsx',
		source: 'export const S = () => <script src="https://example.com/a.js" />;\n',
		reported: 'next(no-sync-scripts)',
	},
};

// Content oxfmt would rewrite (bullets to `-`, emphasis to `_`) if it weren't ignored.
const README = '# Notes\n\n* star bullet\n*emphasis*\n';

function write(dir: string, file: string, source: string): void {
	mkdirSync(dirname(join(dir, file)), { recursive: true });
	writeFileSync(join(dir, file), source);
}

function pnpm(dir: string, script: string): { status: number | null; output: string } {
	// pnpm is a .cmd shim on Windows, which spawnSync refuses to run without a
	// shell (see src/install/spawn.ts). Without it the run never starts and
	// status comes back null.
	const res = spawnSync('pnpm', [script], {
		cwd: dir,
		encoding: 'utf-8',
		env: { ...process.env, CI: 'true' },
		shell: process.platform === 'win32',
	});
	return { status: res.status, output: `${res.stdout}\n${res.stderr}` };
}

function scaffold(dir: string, flavor: Flavor): { plugins: string[]; dev: Record<string, string> } {
	writeFileSync(
		join(dir, 'package.json'),
		JSON.stringify({ name: `oxlint-${flavor}`, version: '0.0.0', private: true }, null, 2),
	);
	writeFileSync(
		join(dir, 'recipe.json'),
		JSON.stringify(
			{
				units: ['core-oxlint'],
				pm: 'pnpm',
				onConflict: 'overwrite',
				postInstall: 'none',
				options: { oxlintFlavor: flavor },
			},
			null,
			2,
		),
	);
	const run = spawnSync('node', [CLI, '--config', 'recipe.json'], { cwd: dir, encoding: 'utf-8' });
	expect(run.status, `scaffold stderr: ${run.stderr}`).toBe(0);
	return {
		plugins: (JSON.parse(readFileSync(join(dir, '.oxlintrc.json'), 'utf-8')) as OxlintConfig)
			.plugins,
		dev:
			(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8')) as PackageJson)
				.devDependencies ?? {},
	};
}

describe.skipIf(process.env.UB_E2E_LEG === 'main')(
	'core-oxlint flavors (e2e, real install)',
	() => {
		let tmp: string;

		beforeEach(() => {
			tmp = mkdtempSync(join(tmpdir(), 'unbranded-e2e-oxlint-'));
		});

		afterEach(() => {
			rmSync(tmp, { recursive: true, force: true });
		});

		for (const flavor of ['base', 'react', 'next'] as const) {
			it.runIf(flavorRuns(flavor))(
				`${flavor}: lints clean, formats without touching package.json or markdown, and reports a probe per plugin`,
				() => {
					const s = scaffold(tmp, flavor);
					expect(s.dev).toHaveProperty('oxlint');
					expect(s.dev).toHaveProperty('oxfmt');
					expect(s.dev).not.toHaveProperty('eslint');

					if (flavor === 'next') {
						write(tmp, 'app/globals.css', 'body {\n\tmargin: 0;\n}\n');
						write(
							tmp,
							'app/layout.tsx',
							'import \'./globals.css\';\n\nexport default function RootLayout() {\n\treturn (\n\t\t<html lang="en">\n\t\t\t<body>\n\t\t\t\t<main>Hello</main>\n\t\t\t</body>\n\t\t</html>\n\t);\n}\n',
						);
					}

					const clean = pnpm(tmp, 'lint');
					expect(clean.status, clean.output).toBe(0);

					write(tmp, 'README.md', README);
					const pkgBefore = readFileSync(join(tmp, 'package.json'));
					const format = pnpm(tmp, 'format');
					expect(format.status, format.output).toBe(0);
					expect(readFileSync(join(tmp, 'package.json')).equals(pkgBefore)).toBe(true);
					expect(readFileSync(join(tmp, 'README.md'), 'utf-8')).toBe(README);

					for (const plugin of s.plugins) {
						const probe = PROBES[plugin];
						expect(probe, `no probe for plugin ${plugin}; add one to PROBES`).toBeDefined();
						write(tmp, probe!.file, probe!.source);
					}
					const dirty = pnpm(tmp, 'lint');
					expect(dirty.status, dirty.output).not.toBe(0);
					for (const plugin of s.plugins)
						expect(dirty.output, `${plugin}'s probe didn't report`).toContain(
							PROBES[plugin]!.reported,
						);
				},
			);
		}
	},
);
