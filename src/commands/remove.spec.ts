import type { Unit, UnitId } from '../manifest/types';
import type { StateFile } from '../state/state';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hashBuffer, readStateFile, STATE_SCHEMA, writeStateFile } from '../state/state';
import { planRemoval, runRemove } from './remove';

function unit(id: UnitId, extras: Partial<Unit> = {}): Unit {
	return { id, category: 'lint', label: id, description: '', files: [], ...extras };
}

function h(content: string): string {
	return hashBuffer(Buffer.from(content));
}

describe('planRemoval', () => {
	let tmp: string;

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-remove-plan-'));
	});

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	const catalog: Unit[] = [
		unit('core-eslint', {
			devDependencies: { 'eslint': '9.0.0', 'shared-tool': '1.0.0' },
			packageJsonPatch: { scripts: { lint: 'eslint .' } },
			options: [{
				key: 'eslintFlavor',
				label: 'flavor',
				default: 'base',
				choices: [
					{ value: 'base', label: 'Base' },
					{ value: 'react', label: 'React', devDependencies: { 'react-plugin': '1.0.0' } },
				],
			}],
		}),
		unit('core-vitest', { devDependencies: { 'shared-tool': '1.0.0', 'vitest': '2.0.0' } }),
		unit('opt-vscode'),
	];

	function stateV2(overrides: Partial<StateFile> = {}): StateFile {
		return {
			_tool: 'x',
			schema: STATE_SCHEMA,
			version: '0.7.0',
			units: ['core-eslint', 'core-vitest', 'opt-vscode'],
			files: {
				'eslint.config.mjs': h('cfg\n'),
				'drifted.txt': h('original\n'),
				'.vscode/settings.json': h('{}\n'),
				'vitest.config.ts': h('vt\n'),
			},
			attribution: {
				'eslint.config.mjs': 'core-eslint',
				'drifted.txt': 'core-eslint',
				'.vscode/settings.json': 'opt-vscode',
				'vitest.config.ts': 'core-vitest',
			},
			modes: {
				'eslint.config.mjs': 'copy',
				'drifted.txt': 'copy',
				'.vscode/settings.json': 'merge-json',
				'vitest.config.ts': 'copy',
			},
			options: { eslintFlavor: 'react' },
			...overrides,
		};
	}

	it('partitions the removed unit\'s files: unmodified deletions, drifted flagged, others untouched', () => {
		writeFileSync(join(tmp, 'eslint.config.mjs'), 'cfg\n');
		writeFileSync(join(tmp, 'drifted.txt'), 'user changed this\n');
		writeFileSync(join(tmp, 'vitest.config.ts'), 'vt\n');

		const plan = planRemoval({ targetDir: tmp, state: stateV2(), removeUnits: ['core-eslint'], units: catalog });

		expect(plan.deletions).toEqual([
			{ rel: 'eslint.config.mjs', modified: false },
			{ rel: 'drifted.txt', modified: true },
		]);
		// vitest.config.ts belongs to a remaining unit; settings.json to opt-vscode.
		expect(plan.retained).toEqual([]);
	});

	it('keeps a merge-json file on disk but disowns it, listing it as retained', () => {
		writeFileSync(join(tmp, '.vscode'), ''); // parent placeholder not needed; file check is by rel
		const plan = planRemoval({ targetDir: tmp, state: stateV2(), removeUnits: ['opt-vscode'], units: catalog });
		// Merged files carry user content; deleting them would take that along.
		expect(plan.deletions).toEqual([]);
		expect(plan.retained).toEqual([{ rel: '.vscode/settings.json', mode: 'merge-json' }]);
	});

	it('skips a deletion candidate that no longer exists on disk', () => {
		// Only drifted.txt is present; the config was already hand-deleted.
		writeFileSync(join(tmp, 'drifted.txt'), 'original\n');
		const plan = planRemoval({ targetDir: tmp, state: stateV2(), removeUnits: ['core-eslint'], units: catalog });
		expect(plan.deletions).toEqual([{ rel: 'drifted.txt', modified: false }]);
	});

	it('reference-counts package.json entries against the remaining units, honoring recorded options', () => {
		const plan = planRemoval({ targetDir: tmp, state: stateV2(), removeUnits: ['core-eslint'], units: catalog });

		// eslint is sole-owned; react-plugin exists because the recorded flavor is
		// react; shared-tool is also claimed by core-vitest and must survive.
		expect(plan.pkg.devDependencies?.sort()).toEqual(['eslint', 'react-plugin']);
		expect(plan.pkg.scripts).toEqual({ lint: 'eslint .' });
	});

	it('falls back to manifest replay for a schema-1 state, honoring the solely-owned rule', () => {
		const replayCatalog: Unit[] = [
			unit('core-editorconfig', { files: [{ src: '.editorconfig', dest: '.editorconfig' }] }),
			unit('core-gitattributes', { files: [{ src: 'templates/gitattributes', dest: '.gitattributes' }] }),
			// Declares the same dest as core-editorconfig: with it still installed,
			// the file is not solely owned and must survive.
			unit('opt-vscode', { files: [{ src: 'x', dest: '.editorconfig' }] }),
		];
		writeFileSync(join(tmp, '.editorconfig'), 'root = true\n');
		writeFileSync(join(tmp, '.gitattributes'), '* text=auto\n');
		const v1: StateFile = {
			_tool: 'x',
			schema: 1,
			version: '0.6.0',
			units: ['core-editorconfig', 'core-gitattributes', 'opt-vscode'],
			files: { '.editorconfig': h('root = true\n'), '.gitattributes': h('* text=auto\n') },
		};

		const shared = planRemoval({ targetDir: tmp, state: v1, removeUnits: ['core-editorconfig'], units: replayCatalog });
		expect(shared.deletions).toEqual([]);

		const sole = planRemoval({ targetDir: tmp, state: v1, removeUnits: ['core-gitattributes'], units: replayCatalog });
		expect(sole.deletions).toEqual([{ rel: '.gitattributes', modified: false }]);
	});

	it('surfaces removeNotes and flags engines/packageManager as manual', () => {
		const noted: Unit[] = [
			unit('opt-husky', { removeNotes: 'git config --unset core.hooksPath if you are dropping hooks entirely.' }),
			unit('core-node-version', { packageJsonPatch: { engines: { node: '>=22' }, packageManager: 'pnpm@10' } }),
		];
		const state: StateFile = {
			_tool: 'x',
			schema: STATE_SCHEMA,
			version: '0.7.0',
			units: ['opt-husky', 'core-node-version'],
			files: {},
		};
		const plan = planRemoval({ targetDir: tmp, state, removeUnits: ['opt-husky', 'core-node-version'], units: noted });
		expect(plan.notes).toEqual(['git config --unset core.hooksPath if you are dropping hooks entirely.']);
		expect(plan.manualPkg.length).toBeGreaterThan(0);
		expect(plan.manualPkg.join(' ')).toContain('engines');
	});
});

describe('runRemove', () => {
	let tmp: string;

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-remove-run-'));
	});

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	// Fixtures use the REAL catalog: opt-shadcn implies core-tailwind, and their
	// real dependency footprints drive the package.json assertions.
	function scaffoldShadcn(): void {
		writeFileSync(join(tmp, 'package.json'), `${JSON.stringify({
			name: 'fixture',
			devDependencies: { 'tailwindcss': '4.3.0', '@tailwindcss/postcss': '4.3.0' },
			dependencies: { 'clsx': '2.1.1', 'tailwind-merge': '3.6.0' },
		}, null, '\t')}\n`);
		writeFileSync(join(tmp, 'components.json'), '{}\n');
		writeFileSync(join(tmp, 'utils.ts'), 'cn\n');
		writeStateFile({
			targetDir: tmp,
			units: ['opt-shadcn', 'core-tailwind'],
			writes: [
				{ dest: join(tmp, 'components.json'), unit: 'opt-shadcn', mode: 'copy' },
				{ dest: join(tmp, 'utils.ts'), unit: 'opt-shadcn', mode: 'copy' },
			],
		});
	}

	it('refuses to strand a dependent and names it, changing nothing', async () => {
		scaffoldShadcn();
		const before = readFileSync(join(tmp, '.unbranded.json'), 'utf-8');

		expect(await runRemove('core-tailwind', { cwd: tmp, yes: true })).toBe(1);
		expect(readFileSync(join(tmp, '.unbranded.json'), 'utf-8')).toBe(before);
		expect(existsSync(join(tmp, 'components.json'))).toBe(true);
	});

	it('removes the closure under --cascade: files, package.json entries, and all tracking', async () => {
		scaffoldShadcn();

		expect(await runRemove('core-tailwind', { cwd: tmp, yes: true, cascade: true })).toBe(0);

		expect(existsSync(join(tmp, 'components.json'))).toBe(false);
		expect(existsSync(join(tmp, 'utils.ts'))).toBe(false);
		const pkg = JSON.parse(readFileSync(join(tmp, 'package.json'), 'utf-8')) as Record<string, unknown>;
		expect('dependencies' in pkg).toBe(false);
		expect('devDependencies' in pkg).toBe(false);
		// Last tracked units gone: envelope and sidecar go with them.
		expect(existsSync(join(tmp, '.unbranded.json'))).toBe(false);
		expect(existsSync(join(tmp, '.unbranded'))).toBe(false);
	});

	it('keeps a modified file under --yes and still succeeds', async () => {
		scaffoldShadcn();
		writeFileSync(join(tmp, 'utils.ts'), 'my own cn\n');

		expect(await runRemove('opt-shadcn', { cwd: tmp, yes: true })).toBe(0);

		// Unmodified file deleted; the user's edited one survives but is disowned.
		expect(existsSync(join(tmp, 'components.json'))).toBe(false);
		expect(readFileSync(join(tmp, 'utils.ts'), 'utf-8')).toBe('my own cn\n');
		const state = readStateFile(tmp);
		expect(state?.units).toEqual(['core-tailwind']);
		expect(state?.files['utils.ts']).toBeUndefined();
		// tailwindcss survives the shadcn removal: core-tailwind still claims it.
		const pkg = JSON.parse(readFileSync(join(tmp, 'package.json'), 'utf-8')) as { devDependencies: Record<string, string> };
		expect(pkg.devDependencies.tailwindcss).toBe('4.3.0');
	});

	it('previews under --dry-run and touches nothing', async () => {
		scaffoldShadcn();
		const before = readFileSync(join(tmp, '.unbranded.json'), 'utf-8');

		expect(await runRemove('opt-shadcn', { cwd: tmp, dryRun: true })).toBe(0);

		expect(existsSync(join(tmp, 'components.json'))).toBe(true);
		expect(readFileSync(join(tmp, '.unbranded.json'), 'utf-8')).toBe(before);
	});

	it('errors on a unit that is not tracked here', async () => {
		scaffoldShadcn();
		expect(await runRemove('core-vitest', { cwd: tmp, yes: true })).toBe(1);
		expect(await runRemove('not-a-unit', { cwd: tmp, yes: true })).toBe(1);
	});

	it('errors when there is no state file at all', async () => {
		expect(await runRemove('core-tailwind', { cwd: tmp, yes: true })).toBe(1);
	});
});
