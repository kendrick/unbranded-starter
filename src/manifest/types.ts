export type UnitId =
	| 'core-eslint' | 'core-stylelint' | 'core-typescript' | 'core-tailwind'
	| 'core-vitest' | 'core-postcss' | 'core-editorconfig'
	| 'opt-monorepo' | 'opt-husky' | 'opt-playwright' | 'opt-shadcn';

export type Category = 'lint' | 'style' | 'types' | 'test' | 'e2e' | 'monorepo' | 'ui' | 'git';

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

	// Templated against the detected PM. Manifest authors write the canonical
	// shape (e.g. `pnpm exec husky init`); the runtime substitutes the user's
	// actual PM before spawning.
	command: string;

	prompt: string;
	default: boolean;
}

export interface Unit {
	id: UnitId;
	category: Category;
	label: string;
	description: string;
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
	files: FileOp[];

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
	};
}
