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
	src: string;

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

export interface Unit {
	id: UnitId;
	category: Category;
	label: string;
	description: string;
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
	files: FileOp[];

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
