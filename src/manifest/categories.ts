import type { Category } from './types';

// Human-readable group headers, and — via insertion order — the canonical
// display order for categories. Both the interactive multiselect (init.ts) and
// `unbranded list` read this, so the two surfaces can never drift apart on
// ordering or naming. Foundation first because it's the universal baseline;
// monorepo last because it's the most niche. The fallback to a raw category key
// only fires if a future category lands here without an explicit label.
export const CATEGORY_LABELS: Record<Category, string> = {
	foundation: 'Foundation',
	lint: 'Linting',
	types: 'TypeScript',
	style: 'Styles',
	test: 'Testing',
	e2e: 'End-to-end',
	ui: 'UI',
	git: 'Git hooks',
	monorepo: 'Monorepo',
};

// Frozen display order derived from the labels above, so sorts have one source
// of truth instead of re-deriving it from Object.keys at each call site.
export const CATEGORY_ORDER = Object.keys(CATEGORY_LABELS) as Category[];
