import type { Unit } from '../manifest/types';
import { describe, expect, it } from 'vitest';
import { buildRecommendations } from './vscode-extensions';

function unit(id: string, recommendedExtensions?: string[]): Unit {
	return { id: id as Unit['id'], category: 'editor', label: '', description: '', files: [], recommendedExtensions };
}

describe('buildRecommendations', () => {
	it('returns an empty list when nothing recommends anything', () => {
		expect(buildRecommendations([unit('opt-vscode')])).toEqual([]);
	});

	it('collects a single unit\'s recommendations', () => {
		expect(buildRecommendations([unit('core-eslint', ['dbaeumer.vscode-eslint'])])).toEqual([
			'dbaeumer.vscode-eslint',
		]);
	});

	it('unions across units, sorted and deduped', () => {
		const recs = buildRecommendations([
			unit('core-stylelint', ['stylelint.vscode-stylelint']),
			unit('core-eslint', ['dbaeumer.vscode-eslint']),
			// A second unit naming the same id must not double it up.
			unit('core-editorconfig', ['editorconfig.editorconfig', 'dbaeumer.vscode-eslint']),
		]);
		expect(recs).toEqual([
			'dbaeumer.vscode-eslint',
			'editorconfig.editorconfig',
			'stylelint.vscode-stylelint',
		]);
	});

	it('keeps the user\'s existing entries in place and folds ours in, deduped', () => {
		// Existing entries stay in their original order (polite, like merge-json);
		// our additions land sorted after them, and anything already present is
		// not re-added.
		const recs = buildRecommendations(
			[unit('core-eslint', ['dbaeumer.vscode-eslint']), unit('core-tailwind', ['bradlc.vscode-tailwindcss'])],
			['some.custom-extension', 'dbaeumer.vscode-eslint'],
		);
		expect(recs).toEqual([
			'some.custom-extension',
			'dbaeumer.vscode-eslint',
			'bradlc.vscode-tailwindcss',
		]);
	});

	it('deduplicates entries already duplicated inside the existing list', () => {
		const recs = buildRecommendations([], ['a.one', 'a.one', 'b.two']);
		expect(recs).toEqual(['a.one', 'b.two']);
	});
});
