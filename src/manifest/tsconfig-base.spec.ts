import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PKG_ROOT } from '../util/paths';
import type { TsFlavor } from './tsconfig-base';
import { buildTsconfigBase, TS_FLAVORS } from './tsconfig-base';

// TS 7's package doesn't export parseConfigFileTextToJson, so strip `//` line
// comments by hand. It has to track strings, because the $schema URL holds `//`.
function stripLineComments(text: string): string {
	let out = '';
	let inString = false;
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (inString) {
			out += ch;
			if (ch === '\\') out += text[++i] ?? '';
			else if (ch === '"') inString = false;
		} else if (ch === '"') {
			inString = true;
			out += ch;
		} else if (ch === '/' && text[i + 1] === '/') {
			while (i < text.length && text[i] !== '\n') i++;
			out += '\n';
		} else {
			out += ch;
		}
	}
	return out;
}

interface Tsconfig {
	compilerOptions: Record<string, unknown>;
	exclude: string[];
}

function parse(flavor: TsFlavor): Tsconfig {
	return JSON.parse(stripLineComments(buildTsconfigBase(flavor))) as Tsconfig;
}

// @antfu/eslint-config 9.5.1's compilerOptions order (sortTsconfig in its dist).
// A core-eslint scaffold lints tsconfig.base.json with `jsonc/sort-keys` against
// this list. A key out of place passes every other unit test and fails only the
// slow scaffold-lint e2e, so this check catches it in the unit run.
const ANTFU_COMPILER_OPTIONS_ORDER = [
	'incremental',
	'composite',
	'tsBuildInfoFile',
	'disableSourceOfProjectReferenceRedirect',
	'disableSolutionSearching',
	'disableReferencedProjectLoad',
	'target',
	'jsx',
	'jsxFactory',
	'jsxFragmentFactory',
	'jsxImportSource',
	'lib',
	'moduleDetection',
	'noLib',
	'reactNamespace',
	'useDefineForClassFields',
	'emitDecoratorMetadata',
	'experimentalDecorators',
	'libReplacement',
	'baseUrl',
	'rootDir',
	'rootDirs',
	'customConditions',
	'module',
	'moduleResolution',
	'moduleSuffixes',
	'noResolve',
	'paths',
	'resolveJsonModule',
	'resolvePackageJsonExports',
	'resolvePackageJsonImports',
	'typeRoots',
	'types',
	'allowArbitraryExtensions',
	'allowImportingTsExtensions',
	'allowUmdGlobalAccess',
	'allowJs',
	'checkJs',
	'maxNodeModuleJsDepth',
	'strict',
	'strictBindCallApply',
	'strictFunctionTypes',
	'strictNullChecks',
	'strictPropertyInitialization',
	'allowUnreachableCode',
	'allowUnusedLabels',
	'alwaysStrict',
	'exactOptionalPropertyTypes',
	'noFallthroughCasesInSwitch',
	'noImplicitAny',
	'noImplicitOverride',
	'noImplicitReturns',
	'noImplicitThis',
	'noPropertyAccessFromIndexSignature',
	'noUncheckedIndexedAccess',
	'noUnusedLocals',
	'noUnusedParameters',
	'useUnknownInCatchVariables',
	'declaration',
	'declarationDir',
	'declarationMap',
	'downlevelIteration',
	'emitBOM',
	'emitDeclarationOnly',
	'importHelpers',
	'importsNotUsedAsValues',
	'inlineSourceMap',
	'inlineSources',
	'mapRoot',
	'newLine',
	'noEmit',
	'noEmitHelpers',
	'noEmitOnError',
	'outDir',
	'outFile',
	'preserveConstEnums',
	'preserveValueImports',
	'removeComments',
	'sourceMap',
	'sourceRoot',
	'stripInternal',
	'allowSyntheticDefaultImports',
	'esModuleInterop',
	'forceConsistentCasingInFileNames',
	'isolatedDeclarations',
	'isolatedModules',
	'preserveSymlinks',
	'verbatimModuleSyntax',
	'erasableSyntaxOnly',
	'skipDefaultLibCheck',
	'skipLibCheck',
];

describe('buildTsconfigBase', () => {
	it('gives node only ES2022 and dom the DOM libs on top', () => {
		expect(parse('node').compilerOptions.lib).toEqual(['ES2022']);
		expect(parse('dom').compilerOptions.lib).toEqual(['ES2022', 'DOM', 'DOM.Iterable']);
	});

	it('keeps every other compiler option and the exclude list identical across flavors', () => {
		const { lib: _nodeLib, ...nodeRest } = parse('node').compilerOptions;
		const { lib: _domLib, ...domRest } = parse('dom').compilerOptions;
		expect(domRest).toEqual(nodeRest);
		expect(parse('dom').exclude).toEqual(parse('node').exclude);
	});

	it.each(TS_FLAVORS)('%s sets the #117 flags and drops allowSyntheticDefaultImports', (flavor) => {
		const options = parse(flavor).compilerOptions;
		expect(options.noImplicitOverride).toBe(true);
		expect(options.moduleDetection).toBe('force');
		expect(options.erasableSyntaxOnly).toBe(true);
		expect(options).not.toHaveProperty('allowSyntheticDefaultImports');
	});

	it.each(TS_FLAVORS)('%s orders compilerOptions the way antfu sorts them', (flavor) => {
		const keys = Object.keys(parse(flavor).compilerOptions);
		const unknown = keys.filter((key) => !ANTFU_COMPILER_OPTIONS_ORDER.includes(key));
		expect(unknown).toEqual([]);
		const sorted = [...keys].sort(
			(a, b) => ANTFU_COMPILER_OPTIONS_ORDER.indexOf(a) - ANTFU_COMPILER_OPTIONS_ORDER.indexOf(b),
		);
		expect(keys).toEqual(sorted);
	});

	// Raw bytes on purpose: comments, blank lines and the trailing newline are part
	// of what ships, and a parsed comparison would wave all of them through.
	it("matches the repo's root tsconfig.base.json byte for byte as the node flavor", () => {
		expect(readFileSync(join(PKG_ROOT, 'tsconfig.base.json'), 'utf-8')).toBe(
			buildTsconfigBase('node'),
		);
	});
});
