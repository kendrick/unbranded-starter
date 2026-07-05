import type { UnitId } from '../manifest/types';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildOptionSchema } from '../manifest/options';
import { assertValidPm, loadConfig, resolveConfig, validate } from './load';

const KNOWN_UNITS = new Set<UnitId>(['core-eslint', 'core-typescript', 'opt-shadcn']);

// A minimal option schema mirroring core-eslint's eslintFlavor, so option
// validation and the `id:value` inline syntax can be exercised without the whole
// manifest.
const SCHEMA = buildOptionSchema([{
	id: 'core-eslint',
	category: 'lint',
	label: 'ESLint',
	description: '',
	files: [],
	options: [{
		key: 'eslintFlavor',
		label: 'ESLint flavor',
		default: 'base',
		choices: [{ value: 'base', label: 'Base' }, { value: 'react', label: 'React' }, { value: 'next', label: 'Next' }],
	}],
}]);

describe('validate (in-memory)', () => {
	const baseValid = {
		units: ['core-eslint'],
		pm: 'pnpm',
		onConflict: 'overwrite',
		postInstall: 'all',
	};

	it('accepts a fully valid object', () => {
		expect(validate(baseValid, KNOWN_UNITS)).toMatchObject({
			units: ['core-eslint'],
			pm: 'pnpm',
			onConflict: 'overwrite',
			postInstall: 'all',
		});
	});

	it('accepts null pm to signal no-install mode', () => {
		expect(validate({ ...baseValid, pm: null }, KNOWN_UNITS).pm).toBeNull();
	});

	it('accepts optional projectName', () => {
		const result = validate({ ...baseValid, projectName: 'acme' }, KNOWN_UNITS);
		expect(result.projectName).toBe('acme');
	});

	it('accepts versions: "latest"', () => {
		expect(validate({ ...baseValid, versions: 'latest' }, KNOWN_UNITS).versions).toBe('latest');
	});

	it('defaults versions to "pinned" when omitted', () => {
		expect(validate(baseValid, KNOWN_UNITS).versions).toBe('pinned');
	});

	it('rejects an invalid versions value', () => {
		expect(() => validate({ ...baseValid, versions: 'newest' }, KNOWN_UNITS))
			.toThrow(/versions must be/);
	});

	it('accepts each git value', () => {
		expect(validate({ ...baseValid, git: 'init' }, KNOWN_UNITS).git).toBe('init');
		expect(validate({ ...baseValid, git: 'init-commit' }, KNOWN_UNITS).git).toBe('init-commit');
		expect(validate({ ...baseValid, git: 'none' }, KNOWN_UNITS).git).toBe('none');
	});

	it('defaults git to "none" when omitted (CI recipes stay repo-free unless asked)', () => {
		expect(validate(baseValid, KNOWN_UNITS).git).toBe('none');
	});

	it('rejects an invalid git value', () => {
		expect(() => validate({ ...baseValid, git: 'clone' }, KNOWN_UNITS))
			.toThrow(/git must be/);
	});

	it('rejects non-object input', () => {
		expect(() => validate(null, KNOWN_UNITS)).toThrow(/JSON object/);
		expect(() => validate([], KNOWN_UNITS)).toThrow(/JSON object/);
		expect(() => validate('hi', KNOWN_UNITS)).toThrow(/JSON object/);
	});

	it('rejects unknown UnitIds', () => {
		expect(() => validate({ ...baseValid, units: ['core-eslint', 'made-up-unit'] }, KNOWN_UNITS))
			.toThrow(/unknown ids: made-up-unit/);
	});

	it('points unknown-unit errors at `unbranded list`', () => {
		expect(() => validate({ ...baseValid, units: ['made-up-unit'] }, KNOWN_UNITS))
			.toThrow(/unbranded list/);
	});

	it('rejects non-array units', () => {
		expect(() => validate({ ...baseValid, units: 'core-eslint' }, KNOWN_UNITS))
			.toThrow(/units must be an array/);
	});

	it('rejects invalid pm', () => {
		expect(() => validate({ ...baseValid, pm: 'cargo' }, KNOWN_UNITS))
			.toThrow(/pm must be one of/);
	});

	it('rejects invalid onConflict', () => {
		expect(() => validate({ ...baseValid, onConflict: 'maybe' }, KNOWN_UNITS))
			.toThrow(/onConflict must be/);
	});

	it('rejects invalid postInstall', () => {
		expect(() => validate({ ...baseValid, postInstall: 'some' }, KNOWN_UNITS))
			.toThrow(/postInstall must be/);
	});

	it('rejects non-string projectName when present', () => {
		expect(() => validate({ ...baseValid, projectName: 42 }, KNOWN_UNITS))
			.toThrow(/projectName must be a string/);
	});

	it('accepts a boolean force flag and leaves it undefined when omitted', () => {
		expect(validate({ ...baseValid, force: true }, KNOWN_UNITS).force).toBe(true);
		expect(validate(baseValid, KNOWN_UNITS).force).toBeUndefined();
	});

	it('rejects a non-boolean force', () => {
		expect(() => validate({ ...baseValid, force: 'yes' }, KNOWN_UNITS))
			.toThrow(/force must be a boolean/);
	});
});

describe('loadConfig (file IO)', () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), 'unbranded-config-'));
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it('reads a valid JSON config file', () => {
		const path = join(dir, 'recipe.json');
		writeFileSync(path, JSON.stringify({
			units: ['core-eslint'],
			pm: 'pnpm',
			onConflict: 'skip',
			postInstall: 'none',
		}));
		expect(loadConfig(path, KNOWN_UNITS)).toMatchObject({ pm: 'pnpm', onConflict: 'skip' });
	});

	it('throws on missing file', () => {
		expect(() => loadConfig(join(dir, 'nope.json'), KNOWN_UNITS))
			.toThrow(/--config file not found/);
	});

	it('throws on non-json extension', () => {
		const path = join(dir, 'recipe.yaml');
		writeFileSync(path, 'units: []');
		expect(() => loadConfig(path, KNOWN_UNITS))
			.toThrow(/supports \.json only/);
	});

	it('throws on malformed JSON', () => {
		const path = join(dir, 'recipe.json');
		writeFileSync(path, '{ not json');
		expect(() => loadConfig(path, KNOWN_UNITS))
			.toThrow(/Invalid JSON/);
	});
});

describe('resolveConfig (inline flags)', () => {
	it('builds a full config from inline flags alone, with sane defaults', () => {
		const config = resolveConfig(null, { units: 'core-eslint,core-typescript', pm: 'pnpm', yes: true }, KNOWN_UNITS);
		expect(config).toMatchObject({
			units: ['core-eslint', 'core-typescript'],
			pm: 'pnpm',
			onConflict: 'overwrite',
			postInstall: 'none',
			versions: 'pinned',
		});
	});

	it('trims whitespace around comma-separated units', () => {
		const config = resolveConfig(null, { units: ' core-eslint , core-typescript ' }, KNOWN_UNITS);
		expect(config.units).toEqual(['core-eslint', 'core-typescript']);
	});

	it('lets inline flags win per field over the recipe file', () => {
		const file = validate({
			units: ['opt-shadcn'],
			pm: 'npm',
			onConflict: 'skip',
			postInstall: 'all',
		}, KNOWN_UNITS);

		const config = resolveConfig(file, { units: 'core-eslint', onConflict: 'overwrite' }, KNOWN_UNITS);
		expect(config.units).toEqual(['core-eslint']); // inline wins
		expect(config.onConflict).toBe('overwrite'); // inline wins
		expect(config.pm).toBe('npm'); // inherited from the recipe
		expect(config.postInstall).toBe('all'); // inherited from the recipe
	});

	it('reuses the recipe validator for an unknown inline unit', () => {
		expect(() => resolveConfig(null, { units: 'not-a-unit', yes: true }, KNOWN_UNITS))
			.toThrow(/unknown ids: not-a-unit/);
	});

	it('reuses the recipe validator for a bad inline pm', () => {
		expect(() => resolveConfig(null, { units: 'core-eslint', pm: 'cargo' }, KNOWN_UNITS))
			.toThrow(/pm must be one of/);
	});

	it('carries the recipe force flag through the merge', () => {
		// force has no inline mirror (it rides the --force flag), so the only way it
		// reaches the resolved config is by surviving resolveConfig untouched.
		const file = validate({ ...{ units: ['core-eslint'], pm: null, onConflict: 'overwrite', postInstall: 'none' }, force: true }, KNOWN_UNITS);
		expect(resolveConfig(file, {}, KNOWN_UNITS).force).toBe(true);
	});
});

describe('options (unit-option selections)', () => {
	const baseValid = { units: ['core-eslint'], pm: 'pnpm', onConflict: 'overwrite', postInstall: 'all' };

	it('accepts a valid options map under the schema', () => {
		const result = validate({ ...baseValid, options: { eslintFlavor: 'react' } }, KNOWN_UNITS, SCHEMA);
		expect(result.options).toEqual({ eslintFlavor: 'react' });
	});

	it('leaves options undefined when omitted', () => {
		expect(validate(baseValid, KNOWN_UNITS, SCHEMA).options).toBeUndefined();
	});

	it('rejects a non-object options field', () => {
		expect(() => validate({ ...baseValid, options: 'react' }, KNOWN_UNITS, SCHEMA))
			.toThrow(/options must be an object/);
	});

	it('rejects a non-string option value', () => {
		expect(() => validate({ ...baseValid, options: { eslintFlavor: 2 } }, KNOWN_UNITS, SCHEMA))
			.toThrow(/eslintFlavor/);
	});

	it('rejects an unknown option key against the schema', () => {
		expect(() => validate({ ...baseValid, options: { bogusOption: 'x' } }, KNOWN_UNITS, SCHEMA))
			.toThrow(/unknown option/);
	});

	it('rejects an out-of-range option value against the schema', () => {
		expect(() => validate({ ...baseValid, options: { eslintFlavor: 'svelte' } }, KNOWN_UNITS, SCHEMA))
			.toThrow(/eslintFlavor must be one of/);
	});

	it('parses the `id:value` inline --units syntax into options', () => {
		const config = resolveConfig(null, { units: 'core-eslint:react,core-typescript', yes: true }, KNOWN_UNITS, SCHEMA);
		expect(config.units).toEqual(['core-eslint', 'core-typescript']);
		expect(config.options).toEqual({ eslintFlavor: 'react' });
	});

	it('lets an inline `id:value` option override the recipe options', () => {
		const file = validate({ ...baseValid, options: { eslintFlavor: 'base' } }, KNOWN_UNITS, SCHEMA);
		const config = resolveConfig(file, { units: 'core-eslint:next' }, KNOWN_UNITS, SCHEMA);
		expect(config.options).toEqual({ eslintFlavor: 'next' });
	});

	it('rejects an invalid inline flavor value', () => {
		expect(() => resolveConfig(null, { units: 'core-eslint:svelte', yes: true }, KNOWN_UNITS, SCHEMA))
			.toThrow(/eslintFlavor must be one of/);
	});
});

describe('assertValidPm', () => {
	it('accepts the known package managers and null', () => {
		expect(() => assertValidPm('pnpm')).not.toThrow();
		expect(() => assertValidPm(null)).not.toThrow();
	});

	it('rejects anything else with the recipe-style message', () => {
		expect(() => assertValidPm('cargo')).toThrow(/pm must be one of/);
	});
});
