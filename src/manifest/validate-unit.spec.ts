import type { UnitValidationResult } from './validate-unit';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkContainment } from '../fs/contain';
import { PKG_ROOT } from '../util/paths';
import { UNIT_SCHEMA, UNIT_SCHEMA_MIN, validateUnitDefinition } from './validate-unit';

// A definition every field of which is valid, so each test only has to
// override the one field it's exercising.
function validBase(): Record<string, unknown> {
	return {
		schema: 1,
		id: 'fixture-unit',
		category: 'foundation',
		label: 'Fixture',
		description: 'A fixture unit for inline tests.',
		files: [],
	};
}

describe('validateUnitDefinition', () => {
	it('exports the published schema bounds', () => {
		expect(UNIT_SCHEMA).toBe(1);
		expect(UNIT_SCHEMA_MIN).toBe(1);
	});

	it('accepts a minimal valid definition and returns it verbatim', () => {
		const unit = validBase();
		const result = validateUnitDefinition(unit);
		expect(result.ok).toBe(true);
		if (!result.ok)
			return;
		expect(result.unit).toEqual(unit);
	});

	describe('schema-version gate', () => {
		it('flags a missing schema', () => {
			const { schema: _schema, ...rest } = validBase();
			const result = validateUnitDefinition(rest);
			expect(result.ok).toBe(false);
			if (result.ok)
				return;
			expect(result.issues).toContainEqual({ path: 'schema', expected: 'an integer', got: 'missing' });
		});

		it('flags a non-integer schema without the unsupported-schema code', () => {
			const result = validateUnitDefinition({ ...validBase(), schema: 1.5 });
			expect(result.ok).toBe(false);
			if (result.ok)
				return;
			const issue = result.issues.find(i => i.path === 'schema');
			expect(issue).toEqual({ path: 'schema', expected: 'an integer', got: 'number' });
			expect(issue?.code).toBeUndefined();
		});

		it('flags a schema newer than UNIT_SCHEMA with the unsupported-schema code', () => {
			const result = validateUnitDefinition({ ...validBase(), schema: 2 });
			expect(result.ok).toBe(false);
			if (result.ok)
				return;
			expect(result.issues).toContainEqual({
				path: 'schema',
				expected: `unit schema ${UNIT_SCHEMA_MIN} through ${UNIT_SCHEMA}`,
				got: '2',
				code: 'unsupported-schema',
			});
		});

		it('flags a schema older than UNIT_SCHEMA_MIN as an ordinary issue', () => {
			const result = validateUnitDefinition({ ...validBase(), schema: 0 });
			expect(result.ok).toBe(false);
			if (result.ok)
				return;
			const issue = result.issues.find(i => i.path === 'schema');
			expect(issue).toEqual({
				path: 'schema',
				expected: `unit schema ${UNIT_SCHEMA_MIN} through ${UNIT_SCHEMA}`,
				got: '0',
			});
			expect(issue?.code).toBeUndefined();
		});
	});

	describe('structural validation', () => {
		it('rejects an unknown top-level key', () => {
			const result = validateUnitDefinition({ ...validBase(), notARealField: true });
			expect(result.ok).toBe(false);
			if (result.ok)
				return;
			expect(result.issues).toContainEqual({ path: 'notARealField', expected: 'a recognized property', got: 'unknown key "notARealField"' });
		});

		it('rejects an id that fails the lowercase-dash pattern', () => {
			const result = validateUnitDefinition({ ...validBase(), id: 'Bad_Id' });
			expect(result.ok).toBe(false);
			if (result.ok)
				return;
			expect(result.issues).toContainEqual({
				path: 'id',
				expected: 'a lowercase id matching ^[a-z0-9][a-z0-9-]*$',
				got: '"Bad_Id"',
			});
		});

		it('rejects a category outside the enum', () => {
			const result = validateUnitDefinition({ ...validBase(), category: 'backend' });
			expect(result.ok).toBe(false);
			if (result.ok)
				return;
			expect(result.issues).toContainEqual({
				path: 'category',
				expected: 'one of: foundation, lint, style, types, test, e2e, monorepo, ui, git, editor, ci',
				got: '"backend"',
			});
		});

		it('rejects an empty label', () => {
			const result = validateUnitDefinition({ ...validBase(), label: '' });
			expect(result.ok).toBe(false);
			if (result.ok)
				return;
			expect(result.issues).toContainEqual({ path: 'label', expected: 'a non-empty string', got: '""' });
		});

		it('reports a missing description as "missing", not a type mismatch', () => {
			const { description: _description, ...rest } = validBase();
			const result = validateUnitDefinition(rest);
			expect(result.ok).toBe(false);
			if (result.ok)
				return;
			expect(result.issues).toContainEqual({ path: 'description', expected: 'a non-empty string', got: 'missing' });
		});

		it('allows files: []—a unit may contribute only deps or a package.json patch', () => {
			const result = validateUnitDefinition(validBase());
			expect(result.ok).toBe(true);
		});

		it('rejects a file entry with both src and content', () => {
			const unit = { ...validBase(), files: [{ src: 'a.txt', content: 'x', dest: 'out.txt' }] };
			const result = validateUnitDefinition(unit);
			expect(result.ok).toBe(false);
			if (result.ok)
				return;
			expect(result.issues).toContainEqual({ path: 'files[0]', expected: 'exactly one of: src, content', got: 'both src and content' });
		});

		it('rejects a file entry with neither src nor content', () => {
			const unit = { ...validBase(), files: [{ dest: 'out.txt' }] };
			const result = validateUnitDefinition(unit);
			expect(result.ok).toBe(false);
			if (result.ok)
				return;
			expect(result.issues).toContainEqual({ path: 'files[0]', expected: 'exactly one of: src, content', got: 'neither src nor content' });
		});

		it('rejects an unknown key on a file entry', () => {
			const unit = { ...validBase(), files: [{ content: 'x', dest: 'out.txt', bogus: 1 }] };
			const result = validateUnitDefinition(unit);
			expect(result.ok).toBe(false);
			if (result.ok)
				return;
			expect(result.issues).toContainEqual({ path: 'files[0].bogus', expected: 'a recognized property', got: 'unknown key "bogus"' });
		});

		it('rejects an invalid file mode', () => {
			const unit = { ...validBase(), files: [{ content: 'x', dest: 'out.txt', mode: 'merge' }] };
			const result = validateUnitDefinition(unit);
			expect(result.ok).toBe(false);
			if (result.ok)
				return;
			expect(result.issues).toContainEqual({
				path: 'files[0].mode',
				expected: 'one of: copy, merge-json, append-if-missing',
				got: '"merge"',
			});
		});

		it('rejects a non-exact dependency pin', () => {
			const unit = { ...validBase(), dependencies: { typescript: '^5.0.0' } };
			const result = validateUnitDefinition(unit);
			expect(result.ok).toBe(false);
			if (result.ok)
				return;
			expect(result.issues).toContainEqual({
				path: 'dependencies["typescript"]',
				expected: 'an exact semver pin (e.g. 1.2.3)',
				got: '"^5.0.0"',
			});
		});

		it('accepts an exact dependency pin, including a prerelease/build suffix', () => {
			const unit = { ...validBase(), dependencies: { typescript: '5.4.0-beta.1+abc' } };
			expect(validateUnitDefinition(unit).ok).toBe(true);
		});

		it('rejects an option whose choices array is empty', () => {
			const unit = {
				...validBase(),
				options: [{ key: 'k', label: 'L', default: 'a', choices: [] }],
			};
			const result = validateUnitDefinition(unit);
			expect(result.ok).toBe(false);
			if (result.ok)
				return;
			expect(result.issues).toContainEqual({ path: 'options[0].choices', expected: 'a non-empty array', got: 'empty array' });
		});

		it('rejects an option default that names no choice', () => {
			const unit = {
				...validBase(),
				options: [{ key: 'k', label: 'L', default: 'zzz', choices: [{ value: 'a', label: 'A' }] }],
			};
			const result = validateUnitDefinition(unit);
			expect(result.ok).toBe(false);
			if (result.ok)
				return;
			expect(result.issues).toContainEqual({ path: 'options[0].default', expected: 'one of: a', got: '"zzz"' });
		});

		it('accepts an option default that matches one of its choices', () => {
			const unit = {
				...validBase(),
				options: [{ key: 'k', label: 'L', default: 'a', choices: [{ value: 'a', label: 'A' }] }],
			};
			expect(validateUnitDefinition(unit).ok).toBe(true);
		});

		it('recurses into an option choice\'s files', () => {
			const unit = {
				...validBase(),
				options: [{
					key: 'k',
					label: 'L',
					default: 'a',
					choices: [{ value: 'a', label: 'A', files: [{ dest: 'x.txt' }] }],
				}],
			};
			const result = validateUnitDefinition(unit);
			expect(result.ok).toBe(false);
			if (result.ok)
				return;
			expect(result.issues).toContainEqual({
				path: 'options[0].choices[0].files[0]',
				expected: 'exactly one of: src, content',
				got: 'neither src nor content',
			});
		});

		it('recurses into an option choice\'s dependencies', () => {
			const unit = {
				...validBase(),
				options: [{
					key: 'k',
					label: 'L',
					default: 'a',
					choices: [{ value: 'a', label: 'A', dependencies: { chalk: 'latest' } }],
				}],
			};
			const result = validateUnitDefinition(unit);
			expect(result.ok).toBe(false);
			if (result.ok)
				return;
			expect(result.issues).toContainEqual({
				path: 'options[0].choices[0].dependencies["chalk"]',
				expected: 'an exact semver pin (e.g. 1.2.3)',
				got: '"latest"',
			});
		});

		it('rejects an empty postInstall.command array', () => {
			const unit = { ...validBase(), postInstall: [{ id: 'i', command: [], prompt: 'p', default: true }] };
			const result = validateUnitDefinition(unit);
			expect(result.ok).toBe(false);
			if (result.ok)
				return;
			expect(result.issues).toContainEqual({ path: 'postInstall[0].command', expected: 'a non-empty array', got: 'empty array' });
		});

		it('rejects a postInstall.requires value other than "git"', () => {
			const unit = { ...validBase(), postInstall: [{ id: 'i', command: ['x'], prompt: 'p', default: true, requires: 'npm' }] };
			const result = validateUnitDefinition(unit);
			expect(result.ok).toBe(false);
			if (result.ok)
				return;
			expect(result.issues).toContainEqual({ path: 'postInstall[0].requires', expected: 'one of: git', got: '"npm"' });
		});

		it('rejects a non-string value in packageJsonPatch.scripts', () => {
			const unit = { ...validBase(), packageJsonPatch: { scripts: { build: 123 } } };
			const result = validateUnitDefinition(unit);
			expect(result.ok).toBe(false);
			if (result.ok)
				return;
			expect(result.issues).toContainEqual({ path: 'packageJsonPatch.scripts["build"]', expected: 'a string', got: 'number' });
		});

		it('accumulates every issue from a badly-formed definition in one pass', () => {
			const result = validateUnitDefinition({
				id: 'Bad_Id',
				category: 'backend',
				label: '',
				description: 'ok',
				files: [],
			});
			expect(result.ok).toBe(false);
			if (result.ok)
				return;
			// schema (missing) + id (pattern) + category (enum) + label (empty)—none
			// of these should have short-circuited the others.
			expect(result.issues).toContainEqual({ path: 'schema', expected: 'an integer', got: 'missing' });
			expect(result.issues).toContainEqual({
				path: 'id',
				expected: 'a lowercase id matching ^[a-z0-9][a-z0-9-]*$',
				got: '"Bad_Id"',
			});
			expect(result.issues).toContainEqual({
				path: 'category',
				expected: 'one of: foundation, lint, style, types, test, e2e, monorepo, ui, git, editor, ci',
				got: '"backend"',
			});
			expect(result.issues).toContainEqual({ path: 'label', expected: 'a non-empty string', got: '""' });
			expect(result.issues.length).toBeGreaterThanOrEqual(4);
		});
	});

	describe('baseDir pass', () => {
		let baseDir: string;

		beforeEach(() => {
			baseDir = mkdtempSync(join(tmpdir(), 'unbranded-validate-unit-'));
			writeFileSync(join(baseDir, 'present.txt'), 'hi\n');
		});

		afterEach(() => {
			rmSync(baseDir, { recursive: true, force: true });
		});

		it('is skipped entirely when baseDir is omitted', () => {
			const unit = { ...validBase(), files: [{ src: 'does-not-exist.txt', dest: 'out.txt' }] };
			expect(validateUnitDefinition(unit).ok).toBe(true);
		});

		it('accepts a src that resolves to a real file under baseDir', () => {
			const unit = { ...validBase(), files: [{ src: 'present.txt', dest: 'out.txt' }] };
			expect(validateUnitDefinition(unit, { baseDir }).ok).toBe(true);
		});

		it('rejects an absolute src', () => {
			const unit = { ...validBase(), files: [{ src: '/etc/passwd', dest: 'out.txt' }] };
			const result = validateUnitDefinition(unit, { baseDir });
			expect(result.ok).toBe(false);
			if (result.ok)
				return;
			expect(result.issues).toContainEqual({
				path: 'files[0].src',
				expected: 'a relative path inside the unit directory',
				got: '"/etc/passwd"',
			});
		});

		it('rejects a src with a .. segment', () => {
			const unit = { ...validBase(), files: [{ src: '../secret.txt', dest: 'out.txt' }] };
			const result = validateUnitDefinition(unit, { baseDir });
			expect(result.ok).toBe(false);
			if (result.ok)
				return;
			expect(result.issues).toContainEqual({
				path: 'files[0].src',
				expected: 'a relative path inside the unit directory',
				got: '"../secret.txt"',
			});
		});

		it('rejects a src that does not exist on disk', () => {
			const unit = { ...validBase(), files: [{ src: 'missing.txt', dest: 'out.txt' }] };
			const result = validateUnitDefinition(unit, { baseDir });
			expect(result.ok).toBe(false);
			if (result.ok)
				return;
			expect(result.issues).toContainEqual({ path: 'files[0].src', expected: 'a file that exists on disk', got: 'not found' });
		});
	});

	describe('knownIds pass', () => {
		it('is skipped entirely when knownIds is omitted', () => {
			const unit = { ...validBase(), implies: ['nope'] };
			expect(validateUnitDefinition(unit).ok).toBe(true);
		});

		it('accepts relations present in the known set', () => {
			const unit = { ...validBase(), implies: ['other-unit'], excludes: ['other-unit'], requires: ['other-unit'] };
			expect(validateUnitDefinition(unit, { knownIds: new Set(['other-unit']) }).ok).toBe(true);
		});

		it('flags implies/excludes/requires entries missing from the known set', () => {
			const unit = { ...validBase(), implies: ['nope'], excludes: ['also-nope'], requires: ['still-nope'] };
			const result = validateUnitDefinition(unit, { knownIds: new Set(['other-unit']) });
			expect(result.ok).toBe(false);
			if (result.ok)
				return;
			expect(result.issues).toContainEqual({ path: 'implies[0]', expected: 'a known unit id', got: '"nope"' });
			expect(result.issues).toContainEqual({ path: 'excludes[0]', expected: 'a known unit id', got: '"also-nope"' });
			expect(result.issues).toContainEqual({ path: 'requires[0]', expected: 'a known unit id', got: '"still-nope"' });
		});
	});
});

// Every fixture under test/fixtures/units, organized so a future `validate
// <dir>` e2e can point at any one subdirectory directly. `valid-*` dirs must
// pass whole (structure + baseDir + knownIds); `invalid-*` dirs must fail.
describe('fixture corpus (test/fixtures/units)', () => {
	const fixturesDir = join(PKG_ROOT, 'test/fixtures/units');
	// Covers every id a fixture's implies/excludes/requires names, so the
	// knownIds pass only fires where a fixture means to exercise it.
	const knownIds = new Set(['fixture-minimal', 'fixture-conflicting', 'fixture-with-src', 'fixture-full']);

	for (const entry of readdirSync(fixturesDir, { withFileTypes: true })) {
		if (!entry.isDirectory())
			continue;
		const dir = join(fixturesDir, entry.name);
		const unit = JSON.parse(readFileSync(join(dir, 'unit.json'), 'utf-8'));

		if (entry.name.startsWith('valid-')) {
			it(`accepts ${entry.name}`, () => {
				const result = validateUnitDefinition(unit, { baseDir: dir, knownIds });
				expect(result.ok).toBe(true);
			});
		}
		else if (entry.name.startsWith('invalid-')) {
			it(`rejects ${entry.name}`, () => {
				const result = validateUnitDefinition(unit, { baseDir: dir, knownIds });
				expect(result.ok).toBe(false);
			});
		}
	}

	it('invalid-newer-schema carries the unsupported-schema code', () => {
		const dir = join(fixturesDir, 'invalid-newer-schema');
		const unit = JSON.parse(readFileSync(join(dir, 'unit.json'), 'utf-8'));
		const result = validateUnitDefinition(unit, { baseDir: dir });
		expect(result.ok).toBe(false);
		if (result.ok)
			return;
		expect(result.issues).toContainEqual({
			path: 'schema',
			expected: `unit schema ${UNIT_SCHEMA_MIN} through ${UNIT_SCHEMA}`,
			got: '99',
			code: 'unsupported-schema',
		});
	});

	it('invalid-unknown-relation only fails once knownIds is supplied', () => {
		const dir = join(fixturesDir, 'invalid-unknown-relation');
		const unit = JSON.parse(readFileSync(join(dir, 'unit.json'), 'utf-8'));
		expect(validateUnitDefinition(unit, { baseDir: dir }).ok).toBe(true);
		const result = validateUnitDefinition(unit, { baseDir: dir, knownIds: new Set(['fixture-minimal']) });
		expect(result.ok).toBe(false);
		if (result.ok)
			return;
		expect(result.issues).toContainEqual({ path: 'implies[0]', expected: 'a known unit id', got: '"does-not-exist"' });
	});
});

// The containment guard's own regression table. A long series of adversarial
// variants, written while this guard was being specified, each turned an
// earlier build green while it still wrote outside the project root — a
// resolved-against-cwd root, a blocklist that missed UNC paths, a collector
// scoped to `mode: 'copy'`. Every section below is named for the gap it
// closes, and every rejection asserts the destination the guard actually
// reported, not merely that validation failed — a build that reports a
// generic "escaped" message passes an assertion of the second kind and fails
// the first, which is the whole reason the weaker assertion is not enough.
describe('containment guard regression table', () => {
	// checkContainment reports the *native*-resolved absolute destination
	// (contain.ts), and validateContainment JSON-quotes it the same way
	// validateFileSources already quotes `src`. A Windows-flavored probe
	// therefore arrives with literal backslashes escaped by JSON.stringify —
	// parsing the reported string back out (rather than substring-matching
	// the raw `got` text) is what keeps a correct build from failing on those
	// cells, per the task's own hazard note.
	function rejectedDestination(result: UnitValidationResult, path: string): string {
		expect(result.ok).toBe(false);
		if (result.ok)
			throw new Error('unreachable: expected a rejection');
		const issue = result.issues.find(i => i.path === path);
		expect(issue).toBeDefined();
		return JSON.parse(issue!.got) as string;
	}

	// Axis 1: shape x field x op-shape. Six escape shapes, crossed with the
	// two fields that carry a destination and the two file-op shapes. Every
	// cell rejects except one: a posix-absolute `dest`, which `resolvePaths`
	// re-roots under the target directory, so it has always been contained.
	// Rejecting it would break working units rather than close the hole.
	// `rename` is never re-rooted, so every `rename` cell rejects regardless
	// of shape.
	describe('shape x field x op-shape grid', () => {
		const SHAPES: { name: string; probe: (marker: string) => string }[] = [
			// Four hops up: enough to escape the containment root regardless of
			// whether the field under test resolves relative to the root itself
			// (`dest`) or to a subdirectory of it (`rename`, relative to
			// dirname(dest) — one hop only clears a one-segment-deep dest).
			{ name: 'relative traversal', probe: marker => `../../../../${marker}` },
			{ name: 'posix-absolute', probe: marker => `/${marker}` },
			{ name: 'Windows drive-absolute', probe: marker => `C:\\${marker}` },
			{ name: 'UNC', probe: marker => `\\\\server\\share\\${marker}` },
			{ name: 'backslash-rooted', probe: marker => `\\${marker}` },
			{ name: 'backslash traversal', probe: marker => `..\\..\\${marker}` },
		];
		const FIELDS = ['dest', 'rename'] as const;
		const OP_SHAPES = ['content', 'src'] as const;

		for (const { name: shapeName, probe } of SHAPES) {
			for (const field of FIELDS) {
				for (const opShape of OP_SHAPES) {
					const accepts = shapeName === 'posix-absolute' && field === 'dest';
					const marker = `ESCAPED-${shapeName.replace(/\s+/g, '-')}-${field}-${opShape}.txt`;

					it(`${accepts ? 'accepts' : 'rejects'} ${shapeName} carried by ${field} (${opShape})`, () => {
						const probeValue = probe(marker);
						const fileOp: Record<string, unknown> = field === 'dest'
							? { dest: probeValue }
							: { dest: 'ok/base.txt', rename: probeValue };
						fileOp[opShape === 'content' ? 'content' : 'src'] = opShape === 'content' ? 'body\n' : 'template.txt';

						const unit = { ...validBase(), files: [fileOp] };
						const result = validateUnitDefinition(unit);

						if (accepts) {
							expect(result.ok).toBe(true);
							return;
						}
						const destination = rejectedDestination(result, 'files[0].dest');
						expect(destination).toContain(marker);
					});
				}
			}
		}
	});

	// Axis 2: the walk. Resolving and comparing flawlessly is worthless if the
	// build never visits the operation that escapes — these three cases each
	// hide an otherwise-ordinary escape somewhere the enumeration could
	// plausibly skip: past the first file, inside a non-default option
	// choice, and on an op whose mode isn't the bare default.
	describe('the walk', () => {
		it('catches an escape in files[1], not just files[0]', () => {
			const unit = {
				...validBase(),
				files: [
					{ dest: 'ok/a.txt', content: 'fine\n' },
					{ dest: '../ESCAPED-walk-position.txt', content: 'pwned\n' },
				],
			};
			const result = validateUnitDefinition(unit);
			const destination = rejectedDestination(result, 'files[1].dest');
			expect(destination).toContain('ESCAPED-walk-position.txt');
		});

		it('catches an escape inside a non-default option choice', () => {
			const unit = {
				...validBase(),
				files: [],
				options: [{
					key: 'flavor',
					label: 'Flavor',
					default: 'safe',
					choices: [
						{ value: 'safe', label: 'Safe', files: [{ dest: 'ok.txt', content: 'fine\n' }] },
						{ value: 'evil', label: 'Evil', files: [{ dest: '../ESCAPED-walk-nondefault-choice.txt', content: 'pwned\n' }] },
					],
				}],
			};
			const result = validateUnitDefinition(unit);
			const destination = rejectedDestination(result, 'options[0].choices[1].files[0].dest');
			expect(destination).toContain('ESCAPED-walk-nondefault-choice.txt');
		});

		it('catches an escape on an op carrying mode: "append-if-missing"', () => {
			const unit = {
				...validBase(),
				files: [{ dest: '../ESCAPED-walk-mode.txt', content: 'pwned\n', mode: 'append-if-missing' }],
			};
			const result = validateUnitDefinition(unit);
			const destination = rejectedDestination(result, 'files[0].dest');
			expect(destination).toContain('ESCAPED-walk-mode.txt');
		});
	});

	// The comparison rule itself, tested against the shared helper
	// directly rather than through validateUnitDefinition — these two cells
	// are what makes the "both tests, not either one" requirement
	// executable instead of merely stated. Read this pair twice: each one
	// alone leaves half the comparison rule unchecked, and a guard passing
	// only that half still accepts a real escape.
	describe('sibling-prefix (the comparison rule)', () => {
		// A root of the test's own choosing — every probe below is derived
		// from this value, not hand-written against a guessed root, per the
		// task's own instruction.
		const root = '/home/dev/my-proj';

		it('rejects a sibling reached absolutely: the root\'s own value with EVIL/x appended', () => {
			// Strip any trailing separator before concatenating, or the probe
			// lands inside the root and proves nothing — root has none here,
			// but the strip is what makes this correct for any root a future
			// edit might swap in.
			const strippedRoot = root.endsWith('/') ? root.slice(0, -1) : root;
			const sibling = `${strippedRoot}EVIL/x`;
			const result = checkContainment(root, { dest: 'ok.txt', rename: sibling });
			expect(result.contained).toBe(false);
		});

		it('rejects the same sibling reached relatively: ../<basename-of-root>EVIL/x', () => {
			const rootBasename = root.split('/').filter(Boolean).pop()!;
			const sibling = `../${rootBasename}EVIL/x`;
			const result = checkContainment(root, { dest: 'ok.txt', rename: sibling });
			expect(result.contained).toBe(false);
		});

		// Self-check for whoever edits this file next: swapping the guard's
		// comparison for a bare `resolved.startsWith(root)` should redden
		// both cells above and nothing else in this describe block.
	});

	// Two further rejection cases outside both axes. The walk's non-default-
	// choice case above already proves every choice is visited regardless of
	// default-ness; this one is simpler on purpose — it proves
	// options[].choices[].files is a recognized destination source at all,
	// independent of that enumeration property, using the *default* choice
	// so the two cases don't collapse into duplicate coverage of the same
	// gap. (The matching direct-copyFileOp rejection lives in
	// src/fs/copy.spec.ts rather than being duplicated here.)
	describe('further rejection cases', () => {
		it('catches an escape through options[].choices[].files on the default choice', () => {
			const unit = {
				...validBase(),
				files: [],
				options: [{
					key: 'flavor',
					label: 'Flavor',
					default: 'evil',
					choices: [
						{ value: 'evil', label: 'Evil', files: [{ dest: '../ESCAPED-default-choice.txt', content: 'pwned\n' }] },
					],
				}],
			};
			const result = validateUnitDefinition(unit);
			const destination = rejectedDestination(result, 'options[0].choices[0].files[0].dest');
			expect(destination).toContain('ESCAPED-default-choice.txt');
		});
	});

	// Three acceptance cases. The posix-absolute `dest` is the shape grid's
	// one accepted cell above; the other two are named here.
	describe('acceptance cases', () => {
		it('accepts a conforming relative dest', () => {
			const unit = { ...validBase(), files: [{ dest: 'src/components/Button.tsx', content: 'export const Button = () => null;\n' }] };
			expect(validateUnitDefinition(unit).ok).toBe(true);
		});

		it('accepts a rename that stays inside the root, written relative', () => {
			// Written relative on purpose, sidestepping the separate question of how
			// an absolute-but-contained `rename` should be read.
			const unit = { ...validBase(), files: [{ dest: 'sub/original.template', content: 'x', rename: 'renamed.txt' }] };
			expect(validateUnitDefinition(unit).ok).toBe(true);
		});
	});

	// What the in-process table can honestly assert about roots: the helper
	// takes its root as a parameter rather than reading a module-level
	// constant. Root-agnosticism itself — a spawned process behaving
	// identically whichever directory it's invoked from — can't be shown
	// in-process (see test/e2e/containment.spec.ts); this is the narrower,
	// still-worth-asserting property that can.
	it('checkContainment takes its root as a parameter, not a module-level constant', () => {
		const op = { dest: 'ok.txt', rename: '../ESCAPED-param-root.txt' };
		const containedHere = checkContainment('/somewhere/deep/proj', op);
		const containedThere = checkContainment('/', op);
		// Under root '/somewhere/deep/proj', '../ESCAPED-param-root.txt' escapes.
		// Under root '/', there is nowhere further up to escape to, so the same
		// op is contained — the verdict changes with the root argument, which a
		// guard reading a fixed constant could never produce.
		expect(containedHere.contained).toBe(false);
		expect(containedThere.contained).toBe(true);
	});
});
