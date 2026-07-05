import type { FileOp } from './types';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PKG_ROOT } from '../util/paths';
import { UNITS } from './index';

// Every FileOp a unit can produce: its static files plus the files hidden inside
// each option choice (a flavor's generated config lives there).
function allFileOps(unit: (typeof UNITS)[number]): FileOp[] {
	const optionFiles = (unit.options ?? []).flatMap(o => o.choices.flatMap(c => c.files ?? []));
	return [...unit.files, ...optionFiles];
}

describe('manifest', () => {
	it('unitId values are unique across the manifest', () => {
		const ids = UNITS.map(u => u.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it('every src-backed file resolves to a real file under PKG_ROOT', () => {
		for (const unit of UNITS) {
			for (const file of allFileOps(unit)) {
				// content-mode files carry their payload inline; there's no src to check.
				if (file.src === undefined)
					continue;
				const fullPath = resolve(PKG_ROOT, file.src);
				expect(existsSync(fullPath), `${unit.id}: ${file.src} → ${fullPath}`).toBe(true);
			}
		}
	});

	it('every FileOp carries exactly one of src or content', () => {
		for (const unit of UNITS) {
			for (const file of allFileOps(unit)) {
				const hasSrc = file.src !== undefined;
				const hasContent = file.content !== undefined;
				expect(hasSrc !== hasContent, `${unit.id}: ${file.dest} must set exactly one of src/content`).toBe(true);
			}
		}
	});

	it('core-eslint declares an eslintFlavor option with base/react/next choices', () => {
		const eslint = UNITS.find(u => u.id === 'core-eslint');
		const option = eslint?.options?.find(o => o.key === 'eslintFlavor');
		expect(option).toBeDefined();
		expect(option?.choices.map(c => c.value)).toEqual(['base', 'react', 'next']);
		expect(option?.default).toBe('base');

		// Each choice generates eslint.config.mjs as inline content and brings its
		// own devDeps; base must stay clear of React-ecosystem packages.
		for (const choice of option?.choices ?? []) {
			expect(choice.files?.[0]).toMatchObject({ dest: 'eslint.config.mjs' });
			expect(choice.files?.[0]?.content).toContain('export default antfu(');
			expect(choice.devDependencies).toHaveProperty('@antfu/eslint-config');
		}
		const base = option?.choices.find(c => c.value === 'base');
		expect(base?.devDependencies).not.toHaveProperty('@eslint-react/eslint-plugin');
		expect(base?.devDependencies).not.toHaveProperty('@next/eslint-plugin-next');
	});

	it('implies/excludes/requires only reference defined UnitIds', () => {
		const defined = new Set(UNITS.map(u => u.id));
		for (const unit of UNITS) {
			for (const id of unit.implies ?? []) {
				expect(defined.has(id), `${unit.id}.implies references unknown ${id}`).toBe(true);
			}
			for (const id of unit.excludes ?? []) {
				expect(defined.has(id), `${unit.id}.excludes references unknown ${id}`).toBe(true);
			}
			for (const id of unit.requires ?? []) {
				expect(defined.has(id), `${unit.id}.requires references unknown ${id}`).toBe(true);
			}
		}
	});
});
