// Explicit allowlist rather than `export *`, so the public contract is
// deliberate: a new internal type or helper on manifest/types or
// manifest/validate-unit can't silently leak into what a consumer imports.
// `UnitId` in particular stays internal—it's the closed 15-member union
// for the built-in catalog, but a public authoring type has to accept any
// id a third-party unit or pack declares (see UnitDefinition in types.ts).

export type {
	Category,
	FileOp,
	PackageJsonPatch,
	PostInstall,
	UnitDefinition,
	UnitOption,
	UnitOptionChoice,
} from './manifest/types';

export type { UnitIssue, UnitValidationResult } from './manifest/validate-unit';
export { UNIT_SCHEMA, UNIT_SCHEMA_MIN, validateUnitDefinition } from './manifest/validate-unit';
