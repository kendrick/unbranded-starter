import { describe, expect, it } from 'vitest';
import { UNITS } from '../manifest/index';
import { buildOptionSchema } from '../manifest/options';
import { resolveSelection } from '../manifest/resolve';
import { loadPreset, presetNames } from './presets';

const KNOWN = new Set(UNITS.map(u => u.id));
const SCHEMA = buildOptionSchema(UNITS);

describe('shipped presets', () => {
	it('ships exactly the advertised set', () => {
		expect(presetNames()).toEqual(['cli', 'next-app', 'node-lib']);
	});

	it('every preset is a valid recipe against the live manifest', () => {
		// The regression that matters: renaming a unit or an option value must
		// break this test, not a user's first `--preset` run.
		for (const name of presetNames()) {
			const preset = loadPreset(name, KNOWN, SCHEMA);
			expect(preset.description.length, name).toBeGreaterThan(0);
			const resolution = resolveSelection(preset.config.units, UNITS);
			expect(resolution.kind, name).toBe('ok');
		}
	});

	it('node-lib and cli differ by exactly the git hooks', () => {
		const nodeLib = loadPreset('node-lib', KNOWN, SCHEMA).config.units;
		const cli = loadPreset('cli', KNOWN, SCHEMA).config.units;
		expect(nodeLib.filter(u => !cli.includes(u))).toEqual(['opt-husky']);
		expect(cli.filter(u => !nodeLib.includes(u))).toEqual([]);
	});

	it('next-app is a superset of node-lib running the next flavor', () => {
		const nodeLib = loadPreset('node-lib', KNOWN, SCHEMA).config;
		const nextApp = loadPreset('next-app', KNOWN, SCHEMA).config;
		for (const unit of nodeLib.units)
			expect(nextApp.units, unit).toContain(unit);
		expect(nextApp.options?.eslintFlavor).toBe('next');
	});

	it('presets default to the safe run: no install, no clobber, no hooks', () => {
		for (const name of presetNames()) {
			const { config } = loadPreset(name, KNOWN, SCHEMA);
			expect(config.pm, name).toBeNull();
			expect(config.onConflict, name).toBe('skip');
			expect(config.postInstall, name).toBe('none');
		}
	});

	it('names the shipped presets when asked for one that does not exist', () => {
		expect(() => loadPreset('vue-app', KNOWN, SCHEMA)).toThrow(/node-lib/);
	});
});
