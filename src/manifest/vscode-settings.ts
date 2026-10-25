import type { AnyUnit, FileOp, RetireEntry } from './types';

// opt-vscode's lint keys depend on which lint unit resolved. A static file named
// ESLint's formatter and fix-on-save action in core-oxlint projects, where the
// ESLint extension has nothing to run. The generated op stays merge-json, so user
// keys survive and `update` regenerates it for the installed set. `retire` is how
// a switch between lint units drops the other unit's keys, which merge-json's
// existing-wins rule can't do by itself.
export const VSCODE_SETTINGS_DEST = '.vscode/settings.json';

// The ids come from the oxc.oxc-vscode 1.64.1 release. The formatter id is
// publisher.name from its package.json. The fix-on-save provider is the one its
// README documents, since package.json declares no codeActions contribution.
const ESLINT_FORMATTER = 'dbaeumer.vscode-eslint';
const ESLINT_FIX = 'source.fixAll.eslint';
const OXC_FORMATTER = 'oxc.oxc-vscode';
const OXC_FIX = 'source.fixAll.oxc';

const FIX_ON_SAVE = 'editor.codeActionsOnSave';
const FORMATTER = 'editor.defaultFormatter';

export interface VscodeSettings {
	content: string;
	retire: RetireEntry[];
}

export function buildVscodeSettings(selected: ReadonlySet<string>): VscodeSettings {
	const oxlint = selected.has('core-oxlint');
	const eslint = !oxlint && selected.has('core-eslint');

	const fixOnSave: Record<string, string> = {};
	if (oxlint) fixOnSave[OXC_FIX] = 'explicit';
	else if (eslint) fixOnSave[ESLINT_FIX] = 'explicit';
	fixOnSave['source.fixAll.stylelint'] = 'explicit';

	// Key order matters because the core-eslint output must stay byte-identical
	// to the static file this generator replaced.
	const settings: Record<string, unknown> = {
		'editor.formatOnSave': true,
		[FIX_ON_SAVE]: fixOnSave,
	};
	if (oxlint) settings[FORMATTER] = OXC_FORMATTER;
	else if (eslint) settings[FORMATTER] = ESLINT_FORMATTER;
	settings['editor.insertSpaces'] = false;
	if (eslint) settings['eslint.useFlatConfig'] = true;
	settings['stylelint.validate'] = ['css', 'postcss', 'scss'];
	settings['[css]'] = { [FORMATTER]: 'stylelint.vscode-stylelint' };
	settings['typescript.tsdk'] = 'node_modules/typescript/lib';
	settings['typescript.enablePromptUseWorkspaceTsdk'] = true;
	settings['search.exclude'] = { '**/node_modules': true, '**/dist': true };

	const retire: RetireEntry[] = [];
	if (oxlint) {
		retire.push(
			{ path: [FORMATTER], value: ESLINT_FORMATTER },
			{ path: [FIX_ON_SAVE, ESLINT_FIX], value: 'explicit' },
			{ path: ['eslint.useFlatConfig'], value: true },
		);
	} else if (eslint) {
		retire.push(
			{ path: [FORMATTER], value: OXC_FORMATTER },
			{ path: [FIX_ON_SAVE, OXC_FIX], value: 'explicit' },
		);
	}

	// A fresh scaffold copies this text verbatim, so the short array stays on one
	// line as in the formatted static file this generator replaced.
	const content = `${JSON.stringify(settings, null, '\t')}\n`.replace(
		/\[\s+"css",\s+"postcss",\s+"scss"\s+\]/,
		'["css", "postcss", "scss"]',
	);
	return { content, retire };
}

export function applyVscodeSettings(unit: AnyUnit, selected: ReadonlySet<string>): AnyUnit {
	if (unit.id !== 'opt-vscode') return unit;
	const { content, retire } = buildVscodeSettings(selected);
	return {
		...unit,
		files: unit.files.map((op): FileOp => {
			if (op.dest !== VSCODE_SETTINGS_DEST) return op;
			const { src: _src, ...rest } = op;
			return { ...rest, content, mode: 'merge-json', retire };
		}),
	};
}
