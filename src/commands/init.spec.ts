import type { Unit, UnitId } from '../manifest/types';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { log, note } from '@clack/prompts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeAndInstall } from '../install/run';
import { unitPicker } from '../prompts/unit-picker/prompt';
import type { StateFile } from '../state/state';
import { STATE_FILENAME } from '../state/state';
import { PKG_ROOT } from '../util/paths';
import { formatPlan, runInit, runPlanJson } from './init';

// The picker is the one TTY boundary in the interactive flow; mocking just it lets
// runInit's threading be exercised against a real temp dir and the real detectors.
vi.mock('../prompts/unit-picker/prompt', () => ({ unitPicker: vi.fn() }));

// The start-from-a-preset select now runs ahead of the picker; answering
// "start empty" keeps these tests on the flow they've always exercised.
// `confirm` is stubbed too so a full (non-dry-run, non---yes) interactive pass can
// answer "Apply?" without a real TTY—everything else stays real.
vi.mock('@clack/prompts', async (importOriginal) => {
	const mod = await importOriginal<typeof import('@clack/prompts')>();
	return { ...mod, select: vi.fn(async () => ''), confirm: vi.fn(), note: vi.fn() };
});

// The install spawn is the other boundary (same seam run.spec mocks): stubbing it
// per-test lets the error path run without a package manager in the loop.
vi.mock('../install/run', async (importOriginal) => {
	const mod = await importOriginal<typeof import('../install/run')>();
	return { ...mod, writeAndInstall: vi.fn() };
});

// Minimal fixture builder — formatPlan only reads id/label/files/deps.
function unit(id: UnitId, label: string, extras: Partial<Unit> = {}): Unit {
	return {
		id,
		category: 'lint',
		label,
		description: '',
		files: [],
		...extras,
	};
}

describe('runInit preselect', () => {
	let tmp: string;

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
		vi.mocked(unitPicker).mockReset();
	});

	it('seeds the picker from a chosen preset, flavor included', async () => {
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-init-preset-'));
		writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'x', version: '0.0.0' }));
		const { select } = await import('@clack/prompts');
		vi.mocked(select).mockResolvedValueOnce('next-app');
		vi.mocked(unitPicker).mockResolvedValue({ ids: [], flavors: {} });

		await runInit({ targetDir: tmp, dryRun: true, inline: { pm: 'pnpm' } });

		const picker = vi.mocked(unitPicker).mock.calls[0]?.[0];
		expect(picker?.initialSelected).toContain('opt-shadcn');
		expect(picker?.initialSelected).toContain('core-oxlint');
		// The preset's recorded flavor beats the environment sniff.
		expect(picker?.initialFlavors?.oxlintFlavor).toBe('next');
	});

	it('opens the picker with the preselected units checked', async () => {
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-init-preselect-'));
		// A package.json puts detectTarget in augment mode (no project-name prompt);
		// inline --pm skips PM detection. The picker mock is then the only prompt.
		writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'x', version: '0.0.0' }));
		vi.mocked(unitPicker).mockResolvedValue({ ids: ['core-editorconfig'], flavors: {} });

		await runInit({
			targetDir: tmp,
			dryRun: true,
			preselect: ['core-editorconfig'],
			inline: { pm: 'pnpm' },
		});

		expect(vi.mocked(unitPicker).mock.calls[0]?.[0]?.initialSelected).toEqual([
			'core-editorconfig',
		]);
	});
});

describe('runInit result', () => {
	let tmp: string;

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
		vi.mocked(unitPicker).mockReset();
		vi.mocked(writeAndInstall).mockReset();
	});

	it('reports ok from a completed dry run', async () => {
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-init-result-'));
		writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'x', version: '0.0.0' }));
		vi.mocked(unitPicker).mockResolvedValue({ ids: ['core-editorconfig'], flavors: {} });

		const result = await runInit({ targetDir: tmp, dryRun: true, inline: { pm: 'pnpm' } });

		expect(result).toEqual({ ok: true });
	});

	it('reports not-ok when the install step errors', async () => {
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-init-result-'));
		writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'x', version: '0.0.0' }));
		vi.mocked(writeAndInstall).mockResolvedValue({
			wrote: true,
			installed: false,
			cancelled: false,
			failed: true,
			error: 'install exploded',
			computedWrites: [],
		});

		// doctor --fix keys its exit code off this flag, so a swallowed install
		// error would report a repaired repo that isn't.
		const result = await runInit({
			targetDir: tmp,
			inline: { units: 'core-editorconfig', pm: 'pnpm', yes: true },
		});

		expect(result).toEqual({ ok: false });
	});
});

describe('runInit exclusions against tracked units (#157)', () => {
	let tmp: string;

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
		vi.restoreAllMocks();
		vi.mocked(writeAndInstall).mockReset();
	});

	function trackedProject(...ids: string[]): void {
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-init-tracked-'));
		writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'x', version: '0.0.0' }));
		writeFileSync(
			join(tmp, STATE_FILENAME),
			JSON.stringify({
				schema: 3,
				units: ids.map((id) => ({ id, source: { kind: 'builtin' } })),
				files: {},
			}),
		);
	}

	// A real exit would kill the runner; throwing lets the test read the code and message.
	function trapExit(): { messages: string[] } {
		const messages: string[] = [];
		vi.spyOn(log, 'error').mockImplementation((m: string) => {
			messages.push(m);
		});
		vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
			throw new Error(`exit ${code}`);
		}) as typeof process.exit);
		return { messages };
	}

	it('rejects a new unit that excludes a tracked one, naming both', async () => {
		trackedProject('core-eslint');
		const { messages } = trapExit();

		await expect(
			runInit({
				targetDir: tmp,
				dryRun: true,
				inline: { units: 'core-oxlint', yes: true, pm: 'pnpm' },
			}),
		).rejects.toThrow('exit 1');

		expect(messages.join('\n')).toContain(
			`core-oxlint and core-eslint can't both be selected (core-eslint is already installed here).`,
		);
	});

	it('rejects the reverse direction, where the tracked unit declares the exclusion', async () => {
		trackedProject('core-oxlint');
		const { messages } = trapExit();

		await expect(
			runInit({
				targetDir: tmp,
				dryRun: true,
				inline: { units: 'core-eslint', yes: true, pm: 'pnpm' },
			}),
		).rejects.toThrow('exit 1');

		expect(messages.join('\n')).toContain(
			`core-eslint and core-oxlint can't both be selected (core-oxlint is already installed here).`,
		);
	});

	it('fails the --dry-run --json path the same way, on stderr', async () => {
		trackedProject('core-eslint');
		const err: string[] = [];
		vi.spyOn(process.stderr, 'write').mockImplementation(((m: string) => {
			err.push(String(m));
			return true;
		}) as typeof process.stderr.write);

		const code = await runPlanJson({
			targetDir: tmp,
			inline: { units: 'core-oxlint', pm: 'pnpm' },
		});

		expect(code).toBe(1);
		expect(err.join('')).toContain(
			`core-oxlint and core-eslint can't both be selected (core-eslint is already installed here).`,
		);
	});

	it('refuses a newer-schema state file before writing anything', async () => {
		trackedProject('core-eslint');
		writeFileSync(join(tmp, STATE_FILENAME), JSON.stringify({ schema: 99, units: [], files: {} }));
		const { messages } = trapExit();

		await expect(
			runInit({ targetDir: tmp, inline: { units: 'core-editorconfig', yes: true, pm: 'pnpm' } }),
		).rejects.toThrow('exit 1');

		expect(messages.join('\n')).toContain('newer unbranded');
		expect(existsSync(join(tmp, '.editorconfig'))).toBe(false);
		expect(vi.mocked(writeAndInstall)).not.toHaveBeenCalled();
	});

	it('refuses an unparseable state file before writing anything', async () => {
		trackedProject('core-eslint');
		const conflicted = `<<<<<<< HEAD\n${readFileSync(join(tmp, STATE_FILENAME), 'utf-8')}=======\n>>>>>>> theirs\n`;
		writeFileSync(join(tmp, STATE_FILENAME), conflicted);
		const { messages } = trapExit();

		await expect(
			runInit({ targetDir: tmp, inline: { units: 'core-editorconfig', yes: true, pm: 'pnpm' } }),
		).rejects.toThrow('exit 1');

		expect(messages.join('\n')).toContain(STATE_FILENAME);
		expect(readFileSync(join(tmp, STATE_FILENAME), 'utf-8')).toBe(conflicted);
		expect(existsSync(join(tmp, '.editorconfig'))).toBe(false);
		expect(vi.mocked(writeAndInstall)).not.toHaveBeenCalled();
	});

	it('refuses a newer-schema state file on the --dry-run --json path, on stderr', async () => {
		trackedProject('core-eslint');
		writeFileSync(join(tmp, STATE_FILENAME), JSON.stringify({ schema: 99, units: [], files: {} }));
		const err: string[] = [];
		vi.spyOn(process.stderr, 'write').mockImplementation(((m: string) => {
			err.push(String(m));
			return true;
		}) as typeof process.stderr.write);

		const code = await runPlanJson({
			targetDir: tmp,
			inline: { units: 'core-editorconfig', pm: 'pnpm' },
		});

		expect(code).toBe(1);
		expect(err.join('')).toContain('newer unbranded');
	});

	it('still lets a re-run re-select a tracked unit', async () => {
		trackedProject('core-eslint');
		const { messages } = trapExit();

		const result = await runInit({
			targetDir: tmp,
			dryRun: true,
			inline: { units: 'core-eslint', yes: true, pm: 'pnpm' },
		});

		expect(result).toEqual({ ok: true });
		expect(messages).toEqual([]);
	});
});

describe('runPlanJson pins under --latest (#158)', () => {
	let tmp: string;

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-plan-json-latest-'));
		writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'x', version: '0.0.0' }));
	});

	afterEach(() => {
		vi.restoreAllMocks();
		rmSync(tmp, { recursive: true, force: true });
	});

	async function envelope(
		opts: Parameters<typeof runPlanJson>[0],
	): Promise<{ devDependencies: Record<string, string> }> {
		const out: string[] = [];
		vi.spyOn(process.stdout, 'write').mockImplementation(((m: string) => {
			out.push(String(m));
			return true;
		}) as typeof process.stdout.write);
		expect(await runPlanJson(opts)).toBe(0);
		return JSON.parse(out.join('')) as { devDependencies: Record<string, string> };
	}

	it("reports the TS line's pin without --latest", async () => {
		expect(
			(await envelope({ targetDir: tmp, inline: { units: 'core-eslint', pm: 'pnpm' } }))
				.devDependencies.typescript,
		).toMatch(/^6\./);
	});

	it("holds typescript to its line's major under the flag and reports `latest` for every other pin (#159)", async () => {
		const plan = await envelope({
			targetDir: tmp,
			latest: true,
			inline: { units: 'core-eslint', pm: 'pnpm' },
		});
		expect(plan.devDependencies.typescript).toBe('^6');
		const { typescript: _held, ...rest } = plan.devDependencies;
		expect(Object.keys(rest).length).toBeGreaterThan(0);
		expect(Object.values(rest).every((v) => v === 'latest')).toBe(true);
	});

	it("holds the line under a recipe's versions field too", async () => {
		writeFileSync(
			join(tmp, 'recipe.json'),
			JSON.stringify({
				units: ['core-eslint'],
				pm: null,
				onConflict: 'overwrite',
				postInstall: 'none',
				versions: 'latest',
			}),
		);
		expect(
			(
				await envelope({
					targetDir: tmp,
					configPath: join(tmp, 'recipe.json'),
					inline: { pm: 'pnpm' },
				})
			).devDependencies.typescript,
		).toBe('^6');
	});

	it('reports `latest` for typescript when no lint unit holds its line', async () => {
		expect(
			(
				await envelope({
					targetDir: tmp,
					latest: true,
					inline: { units: 'core-typescript', pm: 'pnpm' },
				})
			).devDependencies.typescript,
		).toBe('latest');
	});
});

describe('runInit under --latest (#159)', () => {
	let tmp: string;

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
		vi.mocked(writeAndInstall).mockReset();
	});

	it('hands writeAndInstall the held caret and records manifest units in state', async () => {
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-init-latest-'));
		writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'x', version: '0.0.0' }));
		vi.mocked(writeAndInstall).mockResolvedValue({
			wrote: true,
			installed: false,
			cancelled: false,
			failed: false,
			computedWrites: [],
		});

		const result = await runInit({
			targetDir: tmp,
			latest: true,
			inline: { units: 'core-eslint', pm: 'pnpm', yes: true },
		});

		expect(result).toEqual({ ok: true });
		const passed = vi.mocked(writeAndInstall).mock.calls[0]?.[0];
		expect(passed?.latest).toBe(true);
		const ts = passed?.units.find((u) => u.id === 'core-typescript');
		expect(ts?.devDependencies?.typescript).toBe('^6');
		expect(passed?.units.find((u) => u.id === 'core-eslint')?.devDependencies?.eslint).toBe(
			'latest',
		);
		const state = JSON.parse(readFileSync(join(tmp, STATE_FILENAME), 'utf-8')) as {
			units: { id: string }[];
		};
		expect(state.units.map((u) => u.id)).toEqual(
			expect.arrayContaining(['core-eslint', 'core-typescript']),
		);
	});
});

describe('runInit install-failure branching (#114)', () => {
	let tmp: string;

	afterEach(async () => {
		rmSync(tmp, { recursive: true, force: true });
		vi.mocked(unitPicker).mockReset();
		vi.mocked(writeAndInstall).mockReset();
		const { select, confirm } = await import('@clack/prompts');
		// mockClear only, not mockReset—the latter would wipe select's
		// module-mock default implementation (`async () => ''`) for every other
		// describe block in this file that relies on it.
		vi.mocked(select).mockClear();
		vi.mocked(confirm).mockReset();
	});

	it('rolls back without prompting on a non-interactive run', async () => {
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-init-install-failure-noninteractive-'));
		writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'x', version: '0.0.0' }));
		vi.mocked(writeAndInstall).mockResolvedValue({
			wrote: true,
			installed: false,
			cancelled: false,
			failed: true,
			installExitCode: 2,
			computedWrites: [],
		});

		const result = await runInit({
			targetDir: tmp,
			inline: { units: 'core-editorconfig', pm: 'npm', yes: true },
		});

		// Every non-interactive run resolves straight to rollback (nobody's
		// watching to answer a prompt), and rollback is the one branch that
		// deliberately skips the state-file write—see recordState's comment
		// in init.ts. Its absence here is what proves the prompt never fired.
		expect(result).toEqual({ ok: false });
		expect(existsSync(join(tmp, STATE_FILENAME))).toBe(false);
	});

	it('writes state when the interactive prompt answers "keep"', async () => {
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-init-install-failure-keep-'));
		writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'x', version: '0.0.0' }));
		vi.mocked(unitPicker).mockResolvedValue({ ids: ['core-editorconfig'], flavors: {} });
		vi.mocked(writeAndInstall).mockResolvedValue({
			wrote: true,
			installed: false,
			cancelled: false,
			failed: true,
			installExitCode: 2,
			computedWrites: [],
		});

		const { select, confirm } = await import('@clack/prompts');
		// Two select() calls happen before a "keep" answer even means anything:
		// "Start from a preset?" (start empty), then the install-failure prompt
		// itself. The module mock already defaults select to '', but queuing
		// both explicitly keeps this test from depending on that default.
		vi.mocked(select).mockResolvedValueOnce('').mockResolvedValueOnce('keep');
		// inline.pm keeps pm detection out of the prompt sequence without
		// tripping nonInteractive, which is what keeps config===null and this
		// run on the interactive branch (same trick the onConflict tests below
		// use for "Apply?").
		vi.mocked(confirm).mockResolvedValueOnce(true);

		const result = await runInit({ targetDir: tmp, inline: { pm: 'npm' } });

		expect(result).toEqual({ ok: false });
		expect(existsSync(join(tmp, STATE_FILENAME))).toBe(true);
	});

	it('regression: a cancelled (not failed) install still writes state and reports ok', async () => {
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-init-install-cancelled-'));
		writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'x', version: '0.0.0' }));
		// cancelled:true, failed:false is a different thing entirely—an
		// install spawn interrupted mid-run, not a #114 failure—and it kept
		// its pre-#114 behavior on purpose: state written, ok:true.
		vi.mocked(writeAndInstall).mockResolvedValue({
			wrote: true,
			installed: false,
			cancelled: true,
			failed: false,
			computedWrites: [],
		});

		const result = await runInit({
			targetDir: tmp,
			inline: { units: 'core-editorconfig', pm: 'npm', yes: true },
		});

		expect(result).toEqual({ ok: true });
		expect(existsSync(join(tmp, STATE_FILENAME))).toBe(true);
	});
});

describe('runInit records only options its units own (#193)', () => {
	let tmp: string;

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-init-owned-options-'));
		writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'x', version: '0.0.0' }));
		vi.mocked(writeAndInstall).mockResolvedValue({
			wrote: true,
			installed: true,
			cancelled: false,
			failed: false,
			computedWrites: [],
		});
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		rmSync(tmp, { recursive: true, force: true });
		vi.mocked(unitPicker).mockReset();
		vi.mocked(writeAndInstall).mockReset();
		const { confirm } = await import('@clack/prompts');
		vi.mocked(confirm).mockReset();
	});

	function recordedOptions(): Record<string, string> | undefined {
		return (
			JSON.parse(readFileSync(join(tmp, STATE_FILENAME), 'utf-8')) as {
				options?: Record<string, string>;
			}
		).options;
	}

	// The picker hands back a value for every option in the catalog, selected or not.
	async function pick(ids: string[], flavors: Record<string, string>): Promise<void> {
		vi.mocked(unitPicker).mockResolvedValue({ ids, flavors });
		const { confirm } = await import('@clack/prompts');
		vi.mocked(confirm).mockResolvedValueOnce(true);
		expect(await runInit({ targetDir: tmp, inline: { pm: 'pnpm' } })).toEqual({ ok: true });
	}

	it('never records a picker value for a unit the run did not select', async () => {
		await pick(['core-editorconfig'], {
			typescriptLine: '7',
			eslintFlavor: 'base',
			oxlintFlavor: 'base',
		});

		expect(recordedOptions()?.typescriptLine).toBeUndefined();
		expect(recordedOptions()?.eslintFlavor).toBeUndefined();
		expect(recordedOptions()?.oxlintFlavor).toBeUndefined();
	});

	it('records the line for a selected core-typescript and nothing for the unselected lint units', async () => {
		await pick(['core-typescript'], {
			typescriptLine: '6',
			tsFlavor: 'node',
			eslintFlavor: 'next',
			oxlintFlavor: 'next',
		});

		expect(recordedOptions()).toEqual({ typescriptLine: '6', tsFlavor: 'node' });
	});

	it("leaves a later core-typescript run on the project's declared 6.x line", async () => {
		await pick(['core-editorconfig'], { typescriptLine: '7' });
		writeFileSync(
			join(tmp, 'package.json'),
			JSON.stringify({ name: 'x', version: '0.0.0', devDependencies: { typescript: '^6.0.3' } }),
		);

		const out: string[] = [];
		vi.spyOn(process.stdout, 'write').mockImplementation(((m: string) => {
			out.push(String(m));
			return true;
		}) as typeof process.stdout.write);
		expect(
			await runPlanJson({ targetDir: tmp, inline: { units: 'core-typescript', pm: 'pnpm' } }),
		).toBe(0);
		const plan = JSON.parse(out.join('')) as { devDependencies: Record<string, string> };
		expect(plan.devDependencies.typescript).toBe('6.0.3');
	});

	it('hands the picker tracked units as its coupling set, so it sees a tracked core-eslint', async () => {
		writeFileSync(
			join(tmp, STATE_FILENAME),
			JSON.stringify({
				schema: 3,
				units: [{ id: 'core-eslint', source: { kind: 'builtin' } }],
				files: {},
			}),
		);
		vi.mocked(unitPicker).mockResolvedValue({ ids: [], flavors: {} });

		await runInit({ targetDir: tmp, dryRun: true, inline: { pm: 'pnpm' } });

		const picker = vi.mocked(unitPicker).mock.calls[0]?.[0];
		expect([...(picker?.tracked ?? [])]).toEqual(['core-eslint']);
		expect(picker?.initialFlavors?.typescriptLine).toBe('6');
	});

	// A bare eslint.config.mjs badges core-eslint installed, but runInit's own
	// coupling check never counts a probe, and the non-interactive path plans 7.
	it('keeps a probed-only core-eslint out of the coupling set and the seed', async () => {
		writeFileSync(join(tmp, 'eslint.config.mjs'), 'export default [];\n');
		vi.mocked(unitPicker).mockResolvedValue({ ids: [], flavors: {} });

		await runInit({ targetDir: tmp, dryRun: true, inline: { pm: 'pnpm' } });

		const picker = vi.mocked(unitPicker).mock.calls[0]?.[0];
		expect(picker?.installed.has('core-eslint')).toBe(true);
		expect([...(picker?.tracked ?? [])]).toEqual([]);
		expect(picker?.initialFlavors?.typescriptLine).toBe('7');
	});

	// doctor --fix preselects core-eslint. Bending the seed here would leave the
	// picker nothing to restore once the user swaps ESLint for oxlint.
	it('seeds the line without bending it by the preselection', async () => {
		vi.mocked(unitPicker).mockResolvedValue({ ids: [], flavors: {} });

		await runInit({
			targetDir: tmp,
			dryRun: true,
			preselect: ['core-eslint'],
			inline: { pm: 'pnpm' },
		});

		expect(vi.mocked(unitPicker).mock.calls[0]?.[0]?.initialFlavors?.typescriptLine).toBe('7');
	});

	it("drops an untracked unit's picker value on a re-run", async () => {
		await pick(['core-typescript'], { typescriptLine: '6', tsFlavor: 'node' });
		await pick(['core-editorconfig'], { typescriptLine: '6', eslintFlavor: 'next' });

		expect(recordedOptions()).toEqual({ typescriptLine: '6', tsFlavor: 'node' });
	});

	// A run that doesn't re-resolve core-typescript never rewrites its pin, so a
	// new line recorded here would leave state on 7 with package.json still on 6,
	// and the next update would follow the state (PR #194 review).
	it('keeps the recorded line when a re-run does not re-resolve core-typescript', async () => {
		await pick(['core-typescript'], { typescriptLine: '6', tsFlavor: 'node' });
		await pick(['core-editorconfig'], { typescriptLine: '7', tsFlavor: 'dom' });

		expect(recordedOptions()).toEqual({ typescriptLine: '6', tsFlavor: 'node' });
	});
});

// Asserted on the planned tsconfig.base.json's lib line, since the lib list is the
// whole of what separates the two flavors (#117).
describe('runInit tsFlavor default (#117)', () => {
	let tmp: string;

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-init-tsflavor-'));
		vi.mocked(writeAndInstall).mockResolvedValue({
			wrote: true,
			installed: true,
			cancelled: false,
			failed: false,
			computedWrites: [],
		});
	});

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
		vi.mocked(writeAndInstall).mockReset();
	});

	function writePkg(extra: Record<string, unknown> = {}): void {
		writeFileSync(
			join(tmp, 'package.json'),
			JSON.stringify({ name: 'x', version: '0.0.0', ...extra }),
		);
	}

	function trackCoreTypescript(options?: Record<string, string>): void {
		writeFileSync(
			join(tmp, STATE_FILENAME),
			JSON.stringify({
				schema: 3,
				units: [{ id: 'core-typescript', source: { kind: 'builtin' } }],
				files: {},
				...(options ? { options } : {}),
			}),
		);
	}

	async function plannedLibLine(): Promise<string | undefined> {
		await runInit({ targetDir: tmp, inline: { units: 'core-typescript', yes: true, pm: 'pnpm' } });
		const units = vi.mocked(writeAndInstall).mock.calls[0]?.[0].units ?? [];
		const content =
			units.flatMap((u) => u.files).find((f) => f.dest === 'tsconfig.base.json')?.content ?? '';
		return content
			.split('\n')
			.find((line) => line.trim().startsWith('"lib"'))
			?.trim();
	}

	it('plans the node libs for a fresh project with no React dependency', async () => {
		writePkg();
		expect(await plannedLibLine()).toBe('"lib": ["ES2022"],');
	});

	it('plans the DOM libs for a project with react in dependencies', async () => {
		writePkg({ dependencies: { react: '^19.0.0' } });
		expect(await plannedLibLine()).toBe('"lib": ["ES2022", "DOM", "DOM.Iterable"],');
	});

	// Such an install predates #117 and has always had the DOM libs.
	it('keeps the DOM libs for a tracked core-typescript with no recorded tsFlavor', async () => {
		writePkg();
		trackCoreTypescript();
		expect(await plannedLibLine()).toBe('"lib": ["ES2022", "DOM", "DOM.Iterable"],');
	});

	it('lets a recorded tsFlavor: node win over a React dependency', async () => {
		writePkg({ dependencies: { react: '^19.0.0' } });
		trackCoreTypescript({ tsFlavor: 'node' });
		expect(await plannedLibLine()).toBe('"lib": ["ES2022"],');
	});
});

describe('runInit onConflict threading (#113)', () => {
	let tmp: string;

	afterEach(async () => {
		rmSync(tmp, { recursive: true, force: true });
		vi.mocked(unitPicker).mockReset();
		vi.mocked(writeAndInstall).mockReset();
		const { confirm } = await import('@clack/prompts');
		vi.mocked(confirm).mockReset();
	});

	const readState = (dir: string) =>
		JSON.parse(readFileSync(join(dir, STATE_FILENAME), 'utf-8')) as StateFile;

	const mockInstall = () =>
		vi.mocked(writeAndInstall).mockResolvedValue({
			wrote: true,
			installed: true,
			cancelled: false,
			failed: false,
			computedWrites: [],
		});

	it('passes onConflict "skip" through to writeAndInstall when the resolved config says skip', async () => {
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-init-onconflict-skip-'));
		writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'x', version: '0.0.0' }));
		mockInstall();

		// --yes plus an explicit --units skips the picker and the Apply confirm
		// entirely, so config.onConflict comes straight from the inline flag.
		await runInit({
			targetDir: tmp,
			inline: { units: 'core-editorconfig', pm: 'pnpm', onConflict: 'skip', yes: true },
		});

		expect(vi.mocked(writeAndInstall).mock.calls[0]?.[0]?.onConflict).toBe('skip');
	});

	it('does not track a file the user chose to keep (#214)', async () => {
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-init-user-skip-'));
		writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'x', version: '0.0.0' }));
		writeFileSync(join(tmp, '.editorconfig'), '# MY OWN editorconfig\n');
		mockInstall();

		await runInit({
			targetDir: tmp,
			inline: { units: 'core-editorconfig', pm: 'pnpm', onConflict: 'skip', yes: true },
		});

		expect(readFileSync(join(tmp, '.editorconfig'), 'utf-8')).toBe('# MY OWN editorconfig\n');
		const state = readState(tmp);
		expect(state.files).not.toHaveProperty('.editorconfig');
		expect(state.attribution ?? {}).not.toHaveProperty('.editorconfig');
		expect(state.modes ?? {}).not.toHaveProperty('.editorconfig');
	});

	it('does not track a .vscode/settings.json that is not strict JSON (#216)', async () => {
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-init-unparseable-'));
		writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'x', version: '0.0.0' }));
		mkdirSync(join(tmp, '.vscode'));
		const commented = '{\n  // my settings\n  "editor.tabSize": 4\n}\n';
		writeFileSync(join(tmp, '.vscode', 'settings.json'), commented);
		mockInstall();

		await runInit({
			targetDir: tmp,
			inline: { units: 'core-editorconfig,opt-vscode', pm: 'pnpm', yes: true },
		});

		expect(readFileSync(join(tmp, '.vscode', 'settings.json'), 'utf-8')).toBe(commented);
		const state = readState(tmp);
		expect(state.files).not.toHaveProperty('.vscode/settings.json');
		expect(state.attribution ?? {}).not.toHaveProperty('.vscode/settings.json');
		expect(state.modes ?? {}).not.toHaveProperty('.vscode/settings.json');
	});

	it('--dry-run names a .vscode/settings.json that is not strict JSON instead of calling it a key clash (#216)', async () => {
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-init-dry-unparseable-'));
		writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'x', version: '0.0.0' }));
		mkdirSync(join(tmp, '.vscode'));
		writeFileSync(join(tmp, '.vscode', 'settings.json'), '{\n  // mine\n  "a": 1\n}\n');
		const warn = vi.spyOn(log, 'warn').mockImplementation(() => undefined);
		const out: string[] = [];
		vi.spyOn(process.stdout, 'write').mockImplementation(((m: string) => {
			out.push(String(m));
			return true;
		}) as typeof process.stdout.write);

		await runInit({
			targetDir: tmp,
			dryRun: true,
			inline: { units: 'core-editorconfig,opt-vscode', pm: 'pnpm', yes: true },
		});

		const text = out.join('');
		expect(warn).toHaveBeenCalledWith(expect.stringContaining('.vscode/settings.json as is'));
		expect(text).toContain('left as is');
		expect(text).not.toMatch(/conflict\s+\.vscode/);
		expect(text).toContain('1 left as is (not strict JSON)');
		vi.restoreAllMocks();
	});

	it('still tracks a file skipped because it already matches the template (#214)', async () => {
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-init-identical-skip-'));
		writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'x', version: '0.0.0' }));
		writeFileSync(join(tmp, '.editorconfig'), readFileSync(join(PKG_ROOT, '.editorconfig')));
		mockInstall();

		await runInit({
			targetDir: tmp,
			inline: { units: 'core-editorconfig', pm: 'pnpm', onConflict: 'skip', yes: true },
		});

		const state = readState(tmp);
		expect(state.files).toHaveProperty('.editorconfig');
		expect(state.attribution?.['.editorconfig']).toBe('core-editorconfig');
		expect(state.modes?.['.editorconfig']).toBe('copy');
	});

	it("keeps an earlier baseline when a later run skips the file at the user's request (#214)", async () => {
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-init-user-skip-prior-'));
		writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'x', version: '0.0.0' }));
		mockInstall();
		const inline = { units: 'core-editorconfig', pm: 'pnpm', yes: true } as const;

		await runInit({ targetDir: tmp, inline });
		const baseline = readState(tmp).files['.editorconfig'];
		expect(baseline).toBeDefined();

		writeFileSync(join(tmp, '.editorconfig'), '# edited after init\n');
		await runInit({ targetDir: tmp, inline: { ...inline, onConflict: 'skip' } });

		expect(readState(tmp).files['.editorconfig']).toBe(baseline);
	});

	it('passes onConflict undefined on an interactive run, which is what makes collisions prompt', async () => {
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-init-onconflict-interactive-'));
		writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'x', version: '0.0.0' }));
		vi.mocked(unitPicker).mockResolvedValue({ ids: ['core-editorconfig'], flavors: {} });
		vi.mocked(writeAndInstall).mockResolvedValue({
			wrote: true,
			installed: true,
			cancelled: false,
			failed: false,
			computedWrites: [],
		});
		const { confirm } = await import('@clack/prompts');
		// Only "Apply?" fires here: inline.pm already set makes usedInlineFlags true,
		// so runInit skips its own "save this as a recipe?" confirm afterward.
		vi.mocked(confirm).mockResolvedValueOnce(true);

		await runInit({ targetDir: tmp, inline: { pm: 'pnpm' } });

		expect(vi.mocked(writeAndInstall).mock.calls[0]?.[0]?.onConflict).toBeUndefined();
	});
});

describe('formatPlan', () => {
	const eslint = unit('core-eslint', 'ESLint');
	const typescript = unit('core-typescript', 'TypeScript');

	it('names the requirer of an auto-added unit', () => {
		// The provenance line is #30's whole point: a user who only picked ESLint
		// should see *why* TypeScript joined the plan.
		const out = formatPlan(
			[eslint, typescript],
			['core-typescript'],
			{ 'core-typescript': 'core-eslint' },
			'pnpm',
			false,
		);
		expect(out).toContain('• TypeScript (auto — required by ESLint)');
	});

	it('leaves an explicitly-picked unit unannotated', () => {
		const out = formatPlan([eslint, typescript], [], {}, 'pnpm', false);
		expect(out).toContain('• ESLint');
		expect(out).not.toContain('ESLint (auto');
		expect(out).not.toContain('TypeScript (auto');
	});

	it('falls back to a bare (auto) when provenance is somehow missing', () => {
		// Defensive: auto and requiredBy come from the same resolver call, so a gap
		// shouldn't happen — but a bare "(auto)" beats printing "required by undefined".
		const out = formatPlan([eslint, typescript], ['core-typescript'], {}, 'pnpm', false);
		expect(out).toContain('• TypeScript (auto)');
		expect(out).not.toContain('required by');
	});

	// "no package.json" is false on an existing project with `--pm null`, so the
	// wording must follow freshProject, not just pm === null.
	it('says "no package.json" for a null pm on a fresh project', () => {
		const out = formatPlan([eslint], [], {}, null, false, true);
		expect(out).toContain('no install (no package.json)');
		expect(out).not.toContain('pm is null');
	});

	it('says "pm is null" for a null pm on an existing project', () => {
		const out = formatPlan([eslint], [], {}, null, false, false);
		expect(out).toContain('no install (pm is null)');
		expect(out).not.toContain('no package.json');
	});

	it('defaults freshProject to false', () => {
		const out = formatPlan([eslint], [], {}, null, false);
		expect(out).toContain('no install (pm is null)');
		expect(out).not.toContain('no package.json');
	});

	it('names the pm when one is set, fresh project or not', () => {
		expect(formatPlan([eslint], [], {}, 'pnpm', false, true)).toContain('install via pnpm');
		expect(formatPlan([eslint], [], {}, 'npm', false, false)).toContain('install via npm');
	});
});

describe('runInit in a directory with no package.json (#203)', () => {
	let tmp: string;

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-init-fresh-'));
	});

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
		vi.mocked(note).mockClear();
	});

	// Before #203 the project-name prompt stopped every fresh-directory run, so no
	// caller reached formatPlan's freshProject branch.
	it('reaches the freshProject branch of formatPlan through a recipe projectName', async () => {
		writeFileSync(
			join(tmp, 'recipe.json'),
			JSON.stringify({
				units: ['core-editorconfig'],
				pm: null,
				onConflict: 'overwrite',
				postInstall: 'none',
				projectName: '.',
			}),
		);

		const result = await runInit({
			targetDir: tmp,
			dryRun: true,
			configPath: join(tmp, 'recipe.json'),
		});

		expect(result).toEqual({ ok: true });
		expect(
			vi
				.mocked(note)
				.mock.calls.map((c) => c[0])
				.join('\n'),
		).toContain('no install (no package.json)');
	});

	it('refuses a nameless --units run without writing anything', async () => {
		await expect(
			runInit({ targetDir: tmp, inline: { units: 'core-editorconfig', pm: 'pnpm', yes: true } }),
		).rejects.toThrow(/projectName/);
		expect(existsSync(join(tmp, STATE_FILENAME))).toBe(false);
	});
});
