import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
