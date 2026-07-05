export type UnitId
	= | 'core-eslint' | 'core-stylelint' | 'core-typescript' | 'core-tailwind'
		| 'core-vitest' | 'core-postcss' | 'core-editorconfig' | 'core-node-version'
		| 'core-gitattributes'
		| 'opt-monorepo' | 'opt-husky' | 'opt-playwright' | 'opt-shadcn'
		| 'opt-vscode' | 'opt-ci-github';

export type Category = 'foundation' | 'lint' | 'style' | 'types' | 'test' | 'e2e' | 'monorepo' | 'ui' | 'git' | 'editor' | 'ci';

export interface FileOp {
	// Path relative to PKG_ROOT, written posix-style. Manifest authors don't
	// need to think about platform; the runtime joins to native paths via
	// node:path, and files are copied as buffers so Windows \r\n stays intact.
	// Exactly one of `src` or `content` is set.
	src?: string;

	// Inline payload, an alternative to `src` for content computed at selection
	// time rather than shipped as a static template. A flavored unit (core-eslint)
	// bakes its generated config here; it still flows through the same conflict,
	// dry-run, and state-hashing pipeline a copied file gets. Mutually exclusive
	// with `src`.
	content?: string;

	// Path relative to the target cwd. Supports {projectName} interpolation
	// for new-project flows where the directory name is decided at runtime.
	dest: string;

	// Override the destination filename. The reason this exists: npm strips
	// top-level `.gitignore` from tarballs, so we ship it as
	// `.gitignore.template` and rename on copy.
	rename?: string;

	mode?: 'copy' | 'merge-json' | 'append-if-missing';
}

export interface PostInstall {
	id: string;

	// Binary + args, run through the detected PM's exec wrapper. Authors write
	// `['husky', 'init']` once; the runtime prepends `pnpm exec`, `npm exec --`,
	// `yarn exec`, or `bun x` depending on the user's PM.
	command: string[];

	prompt: string;
	default: boolean;

	// Hard precondition the runtime checks before spawning. Today the only
	// value is 'git' (husky init needs a repo); kept open as a string union
	// so we can add others without churning every postInstall entry.
	requires?: 'git';
}

// One selectable choice within a UnitOption. The effects (files, deps) are baked
// into a concrete unit by applyUnitOptions when this choice is picked, so the rest
// of the pipeline never sees an option — just a resolved Unit.
export interface UnitOptionChoice {
	value: string;
	label: string;
	hint?: string;
	// Overlaid onto the unit when chosen: files append, deps merge (choice wins).
	files?: FileOp[];
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
}

// A per-unit variant axis (core-eslint's flavor is the first). Declarative on
// purpose: the choices drive the interactive prompt, the recipe `options` field,
// and `list` surfacing from one source. F-14 formalizes this into the published
// unit schema; keep it data.
export interface UnitOption {
	// Globally unique across units so a recipe's flat `options` map is unambiguous.
	key: string;
	label: string;
	choices: UnitOptionChoice[];
	// The value used when nothing else resolves it (no prompt, no recipe field, no
	// detection). A per-unit detection default (e.g. read the target's deps) lives
	// in the selection layer, not here, so this stays pure data.
	default: string;
}

export interface Unit {
	id: UnitId;
	category: Category;
	label: string;
	description: string;
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
	files: FileOp[];

	// Variant axes for this unit. A unit with options is resolved to a concrete
	// unit by applyUnitOptions before the plan/copy/install pipeline runs.
	options?: UnitOption[];

	// Marketplace ids (publisher.name) this unit wants recommended in VS Code.
	// opt-vscode reads these across the *selected* units to generate
	// .vscode/extensions.json, so the recommendation set tracks what the user
	// actually installed rather than a frozen blob. Internal — never surfaced in
	// the public catalog.
	recommendedExtensions?: string[];

	// Resolver semantics during selection:
	//   implies  — auto-select these too
	//   excludes — symmetric; selecting either side blocks the other
	//   requires — hard precondition; error if any are missing from the set
	implies?: UnitId[];
	excludes?: UnitId[];
	requires?: UnitId[];

	postInstall?: PostInstall[];
	packageJsonPatch?: {
		scripts?: Record<string, string>;
		engines?: Record<string, string>;
		packageManager?: string;
	};
}
