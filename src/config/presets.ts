import type { OptionSchema } from '../manifest/options';
import type { UnitId } from '../manifest/types';
import type { Config } from './load';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PKG_ROOT } from '../util/paths';
import { validate } from './load';

// Shipped presets are plain recipe JSON under presets/ — the files double as
// documentation, and `--preset <name>` is nothing more than `--config` pointed
// at one of them (with one twist: `--units` adds to a preset instead of
// replacing it). Each file carries a `_preset` description the same way a
// saved recipe carries `_generatedBy`: a tolerated extra key.
const PRESETS_DIR = join(PKG_ROOT, 'presets');

export interface Preset {
	name: string;
	description: string;
	config: Config;
}

export function presetNames(): string[] {
	return readdirSync(PRESETS_DIR)
		.filter(f => f.endsWith('.json'))
		.map(f => f.slice(0, -'.json'.length))
		.sort();
}

// Same validation a recipe gets, so a preset that drifts from the manifest (a
// renamed unit, a dropped option value) fails loudly here — and in the spec
// that loads every shipped preset against the live manifest.
export function loadPreset(name: string, knownUnits: Set<UnitId>, schema?: OptionSchema): Preset {
	const path = join(PRESETS_DIR, `${name}.json`);
	if (!existsSync(path))
		throw new Error(`Unknown preset "${name}". Shipped presets: ${presetNames().join(', ')}.`);

	const raw = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
	return {
		name,
		description: typeof raw._preset === 'string' ? raw._preset : '',
		config: validate(raw, knownUnits, schema),
	};
}
