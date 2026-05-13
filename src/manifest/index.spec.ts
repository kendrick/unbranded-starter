import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PKG_ROOT } from '../util/paths';
import { UNITS } from './index';

describe('manifest', () => {
	it('UnitId values are unique across the manifest', () => {
		const ids = UNITS.map((u) => u.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it('every unit file src resolves to a real file under PKG_ROOT', () => {
		for (const unit of UNITS) {
			for (const file of unit.files) {
				const fullPath = resolve(PKG_ROOT, file.src);
				expect(existsSync(fullPath), `${unit.id}: ${file.src} → ${fullPath}`).toBe(true);
			}
		}
	});

	it('implies/excludes/requires only reference defined UnitIds', () => {
		const defined = new Set(UNITS.map((u) => u.id));
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
