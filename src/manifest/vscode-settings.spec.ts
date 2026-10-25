import type { AnyUnit } from './types';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PKG_ROOT } from '../util/paths';
import { UNITS } from './index';
import { applyVscodeSettings, buildVscodeSettings, VSCODE_SETTINGS_DEST } from './vscode-settings';

// opt-in/vscode/settings.json at 3660e44, before the lint keys moved into the
// generator. core-eslint projects must keep it byte for byte.
const LEGACY =
	'{\n\t"editor.formatOnSave": true,\n\t"editor.codeActionsOnSave": {\n\t\t"source.fixAll.eslint": "explicit",\n\t\t"source.fixAll.stylelint": "explicit"\n\t},\n\t"editor.defaultFormatter": "dbaeumer.vscode-eslint",\n\t"editor.insertSpaces": false,\n\t"eslint.useFlatConfig": true,\n\t"stylelint.validate": ["css", "postcss", "scss"],\n\t"[css]": {\n\t\t"editor.defaultFormatter": "stylelint.vscode-stylelint"\n\t},\n\t"typescript.tsdk": "node_modules/typescript/lib",\n\t"typescript.enablePromptUseWorkspaceTsdk": true,\n\t"search.exclude": {\n\t\t"**/node_modules": true,\n\t\t"**/dist": true\n\t}\n}\n';

describe('buildVscodeSettings (#184)', () => {
	it('names the oxc extension and no eslint for core-oxlint', () => {
		const { content, retire } = buildVscodeSettings(new Set(['core-oxlint', 'opt-vscode']));
		const parsed = JSON.parse(content) as Record<string, unknown>;
		expect(parsed['editor.defaultFormatter']).toBe('oxc.oxc-vscode');
		expect(parsed['editor.codeActionsOnSave']).toEqual({
			'source.fixAll.oxc': 'explicit',
			'source.fixAll.stylelint': 'explicit',
		});
		expect(content.toLowerCase()).not.toContain('eslint');
		expect(retire).toEqual([
			{ path: ['editor.defaultFormatter'], value: 'dbaeumer.vscode-eslint' },
			{ path: ['editor.codeActionsOnSave', 'source.fixAll.eslint'], value: 'explicit' },
			{ path: ['eslint.useFlatConfig'], value: true },
		]);
	});

	it("keeps today's file byte for byte for core-eslint", () => {
		const { content, retire } = buildVscodeSettings(new Set(['core-eslint', 'opt-vscode']));
		expect(content).toBe(LEGACY);
		expect(retire).toEqual([
			{ path: ['editor.defaultFormatter'], value: 'oxc.oxc-vscode' },
			{ path: ['editor.codeActionsOnSave', 'source.fixAll.oxc'], value: 'explicit' },
		]);
	});

	it('writes no lint key and retires nothing with neither lint unit', () => {
		const { content, retire } = buildVscodeSettings(new Set(['opt-vscode']));
		const parsed = JSON.parse(content) as Record<string, unknown>;
		expect(parsed).not.toHaveProperty('editor.defaultFormatter');
		expect(parsed).not.toHaveProperty('eslint.useFlatConfig');
		expect(parsed['editor.codeActionsOnSave']).toEqual({ 'source.fixAll.stylelint': 'explicit' });
		expect(content.toLowerCase()).not.toContain('eslint');
		expect(content).not.toContain('oxc');
		expect(retire).toEqual([]);
	});
});

describe('applyVscodeSettings (#184)', () => {
	const vscode = UNITS.find((u) => u.id === 'opt-vscode') as AnyUnit;

	it('leaves every other unit unchanged', () => {
		const other = UNITS.find((u) => u.id === 'opt-husky') as AnyUnit;
		expect(applyVscodeSettings(other, new Set(['core-oxlint']))).toBe(other);
	});

	it('swaps the settings.json src op for a merge-json content op carrying retire', () => {
		const out = applyVscodeSettings(vscode, new Set(['core-oxlint', 'opt-vscode']));
		const op = out.files.find((f) => f.dest === VSCODE_SETTINGS_DEST);
		expect(op?.mode).toBe('merge-json');
		expect(op).not.toHaveProperty('src');
		expect(op?.content).toContain('oxc.oxc-vscode');
		expect(op?.retire).toHaveLength(3);
		expect(out.files).toHaveLength(vscode.files.length);
	});

	it('carries an empty retire list when no lint unit is selected', () => {
		const out = applyVscodeSettings(vscode, new Set(['opt-vscode']));
		expect(out.files.find((f) => f.dest === VSCODE_SETTINGS_DEST)?.retire).toEqual([]);
	});

	// The static file is still the catalog op's `src` and ships in the pack, so it
	// must not drift from the generator's lint-free base.
	it('keeps opt-in/vscode/settings.json equal to the lint-free generator output', () => {
		const onDisk = JSON.parse(
			readFileSync(join(PKG_ROOT, 'opt-in/vscode/settings.json'), 'utf8'),
		) as unknown;
		const generated = JSON.parse(buildVscodeSettings(new Set()).content) as unknown;
		expect(onDisk).toEqual(generated);
	});
});
