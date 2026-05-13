import type { UnitId } from '../manifest/types';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig, validate } from './load';

const KNOWN_UNITS = new Set<UnitId>(['core-eslint', 'core-typescript', 'opt-shadcn']);

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

	it('rejects non-object input', () => {
		expect(() => validate(null, KNOWN_UNITS)).toThrow(/JSON object/);
		expect(() => validate([], KNOWN_UNITS)).toThrow(/JSON object/);
		expect(() => validate('hi', KNOWN_UNITS)).toThrow(/JSON object/);
	});

	it('rejects unknown UnitIds', () => {
		expect(() => validate({ ...baseValid, units: ['core-eslint', 'made-up-unit'] }, KNOWN_UNITS))
			.toThrow(/unknown ids: made-up-unit/);
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
