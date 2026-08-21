const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export interface ParsedUnitRef {
	namespace?: string;
	bare: string;
}

// ID_PATTERN admits no '/', so a slash in a reference can only have come from a
// namespace separator — parsing is total and needs no lookup to disambiguate.
export function parseUnitRef(ref: string): ParsedUnitRef {
	const i = ref.indexOf('/');
	if (i === -1)
		return { bare: ref };
	return { namespace: ref.slice(0, i), bare: ref.slice(i + 1) };
}

export function qualify(namespace: string, bare: string): string {
	return `${namespace}/${bare}`;
}

// A units directory's basename becomes its namespace and flows into qualified
// refs unescaped, so it has to satisfy the same pattern a bare id does — anything
// else would make the qualified form unparseable by parseUnitRef itself.
export function assertValidNamespace(basename: string): void {
	if (!ID_PATTERN.test(basename))
		throw new Error(`namespace must be a lowercase id matching ^[a-z0-9][a-z0-9-]*$, got "${basename}"`);
}

export interface UnitRefContext {
	builtinIds: ReadonlySet<string>;
	namespace?: string;
	localBareIds?: ReadonlySet<string>;
}

// The boundary normalizer: every reference from a CLI flag, a recipe, a state
// file, or a unit's own `implies` list runs through here once, on arrival, so
// nothing downstream ever compares raw strings again.
export function resolveUnitRef(raw: string, ctx: UnitRefContext): string | undefined {
	const parsed = parseUnitRef(raw);

	if (parsed.namespace !== undefined) {
		if (parsed.namespace === '' || parsed.bare === '' || parsed.bare.includes('/'))
			return undefined;
		if (parsed.namespace === ctx.namespace && ctx.localBareIds?.has(parsed.bare))
			return raw;
		return undefined;
	}

	// Own-source-first: a local unit's `implies` names its sibling before it
	// names a built-in, the way an import resolves the local module before the
	// package registry. A local id that collides with a built-in's shadows it
	// only inside this directory — `my-units/core-eslint` stays a distinct unit
	// from `core-eslint` everywhere else.
	if (ctx.namespace !== undefined && ctx.localBareIds?.has(raw))
		return qualify(ctx.namespace, raw);
	if (ctx.builtinIds.has(raw))
		return raw;
	return undefined;
}
