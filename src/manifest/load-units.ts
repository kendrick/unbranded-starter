import type { AnyUnit, UnitDefinition } from './types';
import type { UnitRefContext } from './unit-ref';
import type { UnitIssue } from './validate-unit';
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { discover } from './discover';
import { UNITS } from './index';
import { assertValidNamespace, qualify, resolveUnitRef } from './unit-ref';
import { validateUnitDefinition } from './validate-unit';

export interface SkippedUnit {
	path: string;
	id?: string;
	issues: UnitIssue[];
}

export interface LoadedUnitsDir {
	namespace: string;
	// Qualified ids; implies/requires/excludes already rewritten to canonical
	// form, so resolveSelection and dependentsOf never need to know a unit came
	// from a directory rather than the built-in catalog.
	units: AnyUnit[];
	// Qualified id -> absolute unit dir, the root a unit's `src` template paths
	// resolve from. Built-ins resolve theirs against PKG_ROOT instead.
	baseDirs: Map<string, string>;
	skipped: SkippedUnit[];
	warnings: string[];
}

// Every option key across the built-in catalog. `buildOptionSchema` keys its
// map by option.key alone (see options.ts), so a local unit reusing a
// built-in's key wouldn't error there — it would silently overwrite the
// built-in's entry, and the built-in's prompt or recipe field would vanish
// with no warning. Caught here instead, before the two ever share a map.
const BUILTIN_OPTION_KEYS = new Set(UNITS.flatMap(u => (u.options ?? []).map(o => o.key)));

export function loadUnitsDir(absDir: string, builtinIds: ReadonlySet<string>): LoadedUnitsDir {
	const namespace = basename(resolve(absDir));
	assertValidNamespace(namespace);

	const found = discover(absDir);
	if ('error' in found)
		throw new Error(found.error);

	const skipped: SkippedUnit[] = [];
	const warnings: string[] = [];

	// Pass 1: parse every candidate and settle bare-id uniqueness before anything
	// downstream needs the directory's id set — mirrors validateTarget's two-pass
	// ordering, since a sibling's `implies` can only be checked once the whole
	// set's ids are known.
	interface Parsed { file: string; baseDir: string; value: unknown; bareId?: string }
	const parsed: Parsed[] = [];
	const firstClaim = new Map<string, string>();

	for (const c of found) {
		let value: unknown;
		try {
			value = JSON.parse(readFileSync(c.file, 'utf-8'));
		}
		catch (err) {
			skipped.push({ path: c.file, issues: [{ path: '(document)', expected: 'valid JSON', got: err instanceof Error ? err.message : String(err) }] });
			continue;
		}

		const bareId = idOf(value);
		if (bareId !== undefined) {
			const first = firstClaim.get(bareId);
			if (first !== undefined) {
				skipped.push({
					path: c.file,
					id: bareId,
					issues: [{ path: 'id', expected: 'a bare id unique within this units directory', got: `"${bareId}", already defined by ${first}` }],
				});
				continue;
			}
			firstClaim.set(bareId, c.file);
		}

		parsed.push({ file: c.file, baseDir: c.baseDir, value, bareId });
	}

	// knownIds for relation checking is builtin ids plus this directory's own
	// bare ids — own-source-first, the same scope resolveUnitRef enforces below,
	// so a definition that validates here is guaranteed to rewrite cleanly.
	const knownIds = new Set([...builtinIds, ...firstClaim.keys()]);

	// Pass 2: validate each surviving candidate now that the directory's id set
	// is settled.
	interface Validated { file: string; baseDir: string; unit: UnitDefinition }
	const validated: Validated[] = [];
	for (const p of parsed) {
		const result = validateUnitDefinition(p.value, { baseDir: p.baseDir, knownIds });
		if (!result.ok) {
			skipped.push({ path: p.file, id: p.bareId, issues: result.issues });
			continue;
		}
		validated.push({ file: p.file, baseDir: p.baseDir, unit: result.unit });
	}

	// Option keys are globally unique by contract (types.ts's `options` field
	// comment) — enforced here since it's a cross-unit property no single
	// definition's own validation can see. Skip the whole unit rather than the
	// one option: a partially-loaded unit whose colliding option silently
	// vanished would be a worse surprise than the unit not loading at all.
	const claimedOptionKeys = new Set<string>();
	const survivors: Validated[] = [];
	for (const v of validated) {
		const keys = (v.unit.options ?? []).map(o => o.key);
		const collision = keys.find(k => BUILTIN_OPTION_KEYS.has(k) || claimedOptionKeys.has(k));
		if (collision !== undefined) {
			skipped.push({
				path: v.file,
				id: v.unit.id,
				issues: [{ path: 'options', expected: 'option keys not claimed by a built-in or a sibling unit', got: `key "${collision}" already claimed` }],
			});
			continue;
		}
		for (const k of keys) claimedOptionKeys.add(k);
		survivors.push(v);
	}

	const localBareIds = new Set(survivors.map(v => v.unit.id));
	const units: AnyUnit[] = [];
	const baseDirs = new Map<string, string>();

	for (const v of survivors) {
		const bare = v.unit.id;
		const ctx: UnitRefContext = { builtinIds, namespace, localBareIds };

		// Rewritten here, once, at the load boundary — not in resolve.ts — so
		// resolveSelection and dependentsOf stay pure over one array of units
		// whose ids and relations are already canonical, whichever catalog they
		// came from. A resolver that re-derived qualification per lookup would
		// have to carry namespace context through every call site.
		const implies = resolveAll(v.unit.implies, ctx);
		const requires = resolveAll(v.unit.requires, ctx);
		const excludes = resolveAll(v.unit.excludes, ctx);
		if (implies === undefined || requires === undefined || excludes === undefined) {
			// validateUnitDefinition already checked every relation against
			// knownIds, so this only fires when a referenced sibling was itself
			// dropped after that check (a duplicate id or an option-key
			// collision). Rare, but emitting the unit anyway would hand
			// resolveSelection a dangling reference it has no way to detect.
			skipped.push({
				path: v.file,
				id: bare,
				issues: [{ path: '(relations)', expected: 'every implies/requires/excludes entry to resolve', got: 'a relation named a unit dropped from this directory' }],
			});
			continue;
		}

		// A local id equal to a built-in's is not a collision — `my-units/core-eslint`
		// and `core-eslint` are distinct units and qualify() keeps them so. Still
		// surfaced as a warning: an author who didn't mean to shadow a familiar
		// name would otherwise find out only when the qualified id shows up
		// somewhere they didn't expect it.
		if (builtinIds.has(bare))
			warnings.push(`${namespace}/${bare} shares its id with the built-in unit "${bare}" — they are distinct units; the local one is reachable only as "${namespace}/${bare}".`);

		const qualifiedId = qualify(namespace, bare);
		const { schema: _schema, implies: _implies, requires: _requires, excludes: _excludes, ...rest } = v.unit;
		units.push({
			...rest,
			id: qualifiedId,
			...(v.unit.implies !== undefined ? { implies } : {}),
			...(v.unit.requires !== undefined ? { requires } : {}),
			...(v.unit.excludes !== undefined ? { excludes } : {}),
		});
		baseDirs.set(qualifiedId, v.baseDir);
	}

	return { namespace, units, baseDirs, skipped, warnings };
}

function resolveAll(refs: string[] | undefined, ctx: UnitRefContext): string[] | undefined {
	if (refs === undefined)
		return [];
	const out: string[] = [];
	for (const ref of refs) {
		const resolved = resolveUnitRef(ref, ctx);
		if (resolved === undefined)
			return undefined;
		out.push(resolved);
	}
	return out;
}

function idOf(value: unknown): string | undefined {
	if (typeof value !== 'object' || value === null)
		return undefined;
	const id = (value as { id?: unknown }).id;
	return typeof id === 'string' ? id : undefined;
}
