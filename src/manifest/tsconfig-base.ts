// This repo's root tsconfig.base.json is this generator's `node` output, checked
// in so the repo typechecks against the same config it ships. A unit test fails
// when the two drift, so edit here and regenerate the root file, never the reverse.
//
// The output is JSONC text, not JSON.stringify output, so the comments survive
// into scaffolds. Keys inside compilerOptions follow @antfu/eslint-config's
// tsconfig sort order: a core-eslint scaffold lints this file with
// `jsonc/sort-keys`, and a key out of place fails that lint.
export type TsFlavor = 'node' | 'dom';

export const TS_FLAVORS: TsFlavor[] = ['node', 'dom'];

// The only line that differs between flavors (#117). With DOM globals in scope, a
// Node CLI typechecks a `document` reference that then crashes at runtime.
const LIB: Record<TsFlavor, string[]> = {
	node: ['ES2022'],
	dom: ['ES2022', 'DOM', 'DOM.Iterable'],
};

export function buildTsconfigBase(flavor: TsFlavor): string {
	const lib = `[${LIB[flavor].map((entry) => JSON.stringify(entry)).join(', ')}]`;
	return `{
	"$schema": "https://json.schemastore.org/tsconfig",
	"compilerOptions": {
		"incremental": true,

		// Target & module
		"target": "ES2022",
		// The node flavor leaves out the DOM globals so a CLI can't typecheck a browser API.
		// The dom flavor adds them.
		"lib": ${lib},
		// Treat every file as a module, so a file with no import or export can't leak
		// its top-level names into a shared global scope.
		"moduleDetection": "force",
		"module": "ESNext",
		"moduleResolution": "Bundler",
		"resolveJsonModule": true,
		// TS 6 stopped loading @types/* on its own, and core-typescript installs
		// @types/node alongside this config.
		"types": ["node"],

		// Strictness (the full suite)
		"strict": true,
		"noFallthroughCasesInSwitch": true,
		// With the \`override\` keyword required, renaming a base method breaks the
		// subclass build instead of leaving its override as an unrelated new method.
		"noImplicitOverride": true,
		"noImplicitReturns": true,
		"noUncheckedIndexedAccess": true,
		"noUnusedLocals": true,
		"noUnusedParameters": true,
		"noEmit": true,

		// Module interop. esModuleInterop implies allowSyntheticDefaultImports, so this
		// config doesn't set allowSyntheticDefaultImports.
		"esModuleInterop": true,
		"forceConsistentCasingInFileNames": true,
		"isolatedModules": true,
		"verbatimModuleSyntax": true,
		// Rejects enums, namespaces and parameter properties, which Node's type
		// stripping and other strip-only runners can't execute.
		"erasableSyntaxOnly": true,

		// Build behavior
		"skipLibCheck": true
	},
	"exclude": ["node_modules", "dist", "build", "out", ".next"]
}
`;
}
