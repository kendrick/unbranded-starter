import type { Pm } from '../detect/pm';
import type { UnitId } from '../manifest/types';
import type { StateFile } from '../state/state';
import type { PackageJson } from '../util/package-json';
import type { CatalogUnit } from './list';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inspectPm } from '../detect/pm';
import { readStateFile } from '../state/state';
import { readPackageJson } from '../util/package-json';
import { buildCatalog } from './list';

// Version 2 adds the suppression fields (`suppressed`, `ignoredUnknown`) alongside
// `findings` in the --json output. A reader keying off `schema` can tell the richer
// shape from the original.
export const DOCTOR_SCHEMA = 2;

export interface Finding {
	// Stable machine key so tooling can suppress or track a specific check.
	id: string;
	message: string;
	// Actionable remedy. For a signal a catalog unit provides, this names the
	// `unbranded --units <id>` command; otherwise it's a plain instruction.
	fix: string;
	// Set when a catalog unit resolves the finding, resolved via buildCatalog().
	unit?: UnitId;
}

export interface AuditResult {
	findings: Finding[];
}

// Every finding id auditRepo can emit. Kept explicit so `doctor.ignore` can tell a
// typo from a valid id whose check simply passed this run: an unrecognized id earns
// a warning, a recognized-but-not-firing one stays quiet. Adding a finding means
// adding its id here, and a spec test cross-checks this set against a live audit.
export const KNOWN_FINDING_IDS: ReadonlySet<string> = new Set([
	'malformed-package-json',
	'missing-editorconfig',
	'missing-gitattributes',
	'no-ci-workflow',
	'multiple-lockfiles',
	'pm-field-lockfile-mismatch',
	'workspace-leaf',
	'no-node-version',
	'no-test-script',
	'no-lint-script',
	'ts-dep-no-tsconfig',
	'tsconfig-no-ts-dep',
	'node-version-mismatch',
]);

export interface SuppressionResult {
	// Findings still in force after removing the accepted ids.
	active: Finding[];
	// Findings hidden by doctor.ignore, kept so --json can still list them.
	suppressed: Finding[];
	// ids in doctor.ignore that match no known finding — probably typos.
	unknownIgnored: string[];
}

// Pure partition of a finding list against an accept-list. The ignore ids come from
// readDoctorIgnore, not from here, so this stays a plain data transform to test.
export function applySuppression(findings: Finding[], ignore: readonly string[]): SuppressionResult {
	const ignoreSet = new Set(ignore);
	return {
		active: findings.filter(f => !ignoreSet.has(f.id)),
		suppressed: findings.filter(f => ignoreSet.has(f.id)),
		unknownIgnored: [...new Set(ignore.filter(id => !KNOWN_FINDING_IDS.has(id)))],
	};
}

// Defensive read: a hand-edited doctor.ignore might not be an array or might hold
// junk, and a config typo must degrade to a warning rather than crash the audit.
// Non-string entries are dropped.
export function readDoctorIgnore(state: StateFile | undefined): string[] {
	const raw = state?.doctor?.ignore;
	return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
}

// Lockfile precedence, copied from pm.ts's lockfileSignal so the "which one would
// detection pick" answer here matches what a real run resolves. First present
// wins.
const LOCKFILES = ['pnpm-lock.yaml', 'bun.lock', 'bun.lockb', 'yarn.lock', 'package-lock.json'] as const;

const LOCKFILE_PM: Record<string, Pm> = {
	'pnpm-lock.yaml': 'pnpm',
	'bun.lock': 'bun',
	'bun.lockb': 'bun',
	'yarn.lock': 'yarn',
	'package-lock.json': 'npm',
};

// Pure audit core: filesystem in, findings out, zero writes. Everything the
// command prints is derived from this, so the read-only guarantee lives in one
// place that's easy to reason about and snapshot-test.
export function auditRepo(opts: { cwd: string }): AuditResult {
	const { cwd } = opts;
	const catalog = buildCatalog();
	const findings: Finding[] = [];

	const read = readPackageJson(cwd);
	if (read.kind === 'malformed') {
		findings.push({
			id: 'malformed-package-json',
			message: `package.json is not valid JSON: ${read.error}`,
			fix: 'Repair the JSON syntax in package.json.',
		});
	}
	const pkg: PackageJson = read.kind === 'ok' ? read.pkg : {};
	const hasPkg = read.kind === 'ok';

	// --- File-presence checks (run regardless of a package.json) ---
	if (!existsSync(join(cwd, '.editorconfig'))) {
		findings.push(missingFile(catalog, '.editorconfig', 'No .editorconfig, so editors won\'t agree on whitespace.', 'missing-editorconfig'));
	}
	if (!existsSync(join(cwd, '.gitattributes'))) {
		findings.push(missingFile(catalog, '.gitattributes', 'No .gitattributes, so line endings can differ across platforms.', 'missing-gitattributes'));
	}
	if (!hasCiWorkflow(cwd)) {
		const unit = unitForDest(catalog, '.github/workflows/ci.yml');
		findings.push({
			id: 'no-ci-workflow',
			message: 'No CI workflow found (.github/workflows or .gitlab-ci.yml).',
			fix: fixForUnit(unit, 'Add a CI workflow, e.g. .github/workflows/ci.yml, to run lint and tests on push.'),
			unit,
		});
	}

	// --- Lockfile checks (new logic on top of inspectPm's signals) ---
	const present = LOCKFILES.filter(f => existsSync(join(cwd, f)));
	const picked = present[0]; // precedence-first, matches detection
	if (present.length > 1 && picked) {
		findings.push({
			id: 'multiple-lockfiles',
			message: `Multiple lockfiles present (${present.join(', ')}); detection would pick ${picked}.`,
			fix: `Keep ${picked} and remove the others: ${present.filter(f => f !== picked).join(', ')}.`,
		});
	}

	// inspectPm is the authoritative signal source; we layer cross-checks on top.
	// It reads package.json through pm.ts's throwing reader, so skip it when we've
	// already flagged the manifest as malformed rather than let that error escape.
	const inspection = read.kind === 'malformed' ? undefined : inspectPm(cwd);
	const lockfilePm = picked ? LOCKFILE_PM[picked] : undefined;
	const fieldPm = parsePackageManagerPm(pkg.packageManager);
	if (fieldPm && lockfilePm && fieldPm !== lockfilePm) {
		findings.push({
			id: 'pm-field-lockfile-mismatch',
			message: `packageManager field says ${fieldPm}, but the ${picked} lockfile means detection resolves ${lockfilePm}.`,
			fix: `Align the packageManager field with ${lockfilePm} (or remove the mismatched lockfile).`,
		});
	}
	// A workspace-leaf repo is worth surfacing since installs there are refused.
	if (inspection?.kind === 'workspace-leaf') {
		findings.push({
			id: 'workspace-leaf',
			message: `This is a leaf of the pnpm workspace at ${inspection.workspaceRoot}; unbranded installs from the root.`,
			fix: 'Run unbranded from the workspace root, or wire this package in manually.',
		});
	}

	// --- package.json-derived checks (only meaningful with a manifest) ---
	if (hasPkg) {
		if (!hasNodeVersionPin(cwd, pkg)) {
			// core-node-version computes .nvmrc at write time rather than shipping it
			// as a template, so unitForDest can't see it — name the unit directly.
			const unit = unitForId(catalog, 'core-node-version');
			findings.push({
				id: 'no-node-version',
				message: 'No Node version pin (engines.node, .nvmrc, or packageManager all absent).',
				fix: fixForUnit(unit, 'Add a .nvmrc and engines.node to pin the Node version.'),
				unit,
			});
		}
		if (!hasScript(pkg, 'test')) {
			findings.push(missingScript(catalog, 'test', 'no-test-script', 'No test script in package.json.'));
		}
		if (!hasScript(pkg, 'lint')) {
			findings.push(missingScript(catalog, 'lint', 'no-lint-script', 'No lint script in package.json.'));
		}

		const hasTsDep = Boolean(dep(pkg, 'typescript'));
		const hasTsconfig = existsSync(join(cwd, 'tsconfig.json'));
		if (hasTsDep && !hasTsconfig) {
			findings.push(missingFile(catalog, 'tsconfig.json', 'TypeScript is a dependency but there\'s no tsconfig.json.', 'ts-dep-no-tsconfig'));
		}
		if (hasTsconfig && !hasTsDep) {
			findings.push({
				id: 'tsconfig-no-ts-dep',
				message: 'tsconfig.json is present but typescript isn\'t a dependency.',
				fix: fixForUnit(unitForDest(catalog, 'tsconfig.json'), 'Add typescript as a devDependency.'),
				unit: unitForDest(catalog, 'tsconfig.json'),
			});
		}

		const nodeMismatch = nodeVersionMismatch(cwd, pkg);
		if (nodeMismatch) {
			findings.push({
				id: 'node-version-mismatch',
				message: `engines.node (${nodeMismatch.engines}) and .nvmrc (${nodeMismatch.nvmrc}) disagree on the Node major.`,
				fix: 'Align engines.node and .nvmrc on the same Node major.',
			});
		}
	}

	return { findings };
}

export interface RunDoctorOpts {
	cwd?: string;
	json?: boolean;
	// Turns findings into a non-zero exit so doctor doubles as a hygiene gate.
	// Default stays 0 even with findings, so a report never fails an unrelated job.
	strict?: boolean;
}

// Thin shell over auditRepo: read the accept-list, suppress, render, then translate
// the surviving findings into an exit code. Reading .unbranded.json keeps doctor
// read-only; an untracked repo has no state file, so nothing is suppressed.
export function runDoctor(opts: RunDoctorOpts = {}): number {
	const cwd = opts.cwd ?? process.cwd();
	const { findings } = auditRepo({ cwd });
	const { active, suppressed, unknownIgnored } = applySuppression(findings, readDoctorIgnore(readStateFile(cwd)));

	if (opts.json) {
		process.stdout.write(`${JSON.stringify({
			schema: DOCTOR_SCHEMA,
			ok: active.length === 0,
			findings: active,
			suppressed,
			ignoredUnknown: unknownIgnored,
		}, null, 2)}\n`);
	}
	else {
		process.stdout.write(formatDoctor(active, suppressed, unknownIgnored));
	}

	// Suppressed findings are accepted, so they never fail the gate; only active
	// ones do. An unknown ignore id is a config warning, not a repo defect.
	return opts.strict && active.length > 0 ? 1 : 0;
}

function formatDoctor(active: Finding[], suppressed: Finding[], unknownIgnored: string[]): string {
	const lines: string[] = [];

	if (active.length === 0) {
		lines.push('unbranded doctor: no issues found.');
	}
	else {
		lines.push('unbranded doctor found:', '');
		for (const f of active) {
			lines.push(`  • ${f.message}`);
			lines.push(`    fix: ${f.fix}`);
		}
		lines.push('');
		lines.push(`${active.length} issue${active.length === 1 ? '' : 's'} found.`);
	}

	// A one-line tally keeps accepted findings visible without re-listing them; the
	// ids themselves live in --json for anyone who needs to audit the accept-list.
	if (suppressed.length > 0)
		lines.push(`${suppressed.length} finding${suppressed.length === 1 ? '' : 's'} suppressed (doctor.ignore).`);

	// A typo in doctor.ignore protects nothing, so surface it, but only as a warning
	// since the repo itself may be perfectly healthy.
	if (unknownIgnored.length > 0)
		lines.push(`warning: doctor.ignore lists unknown finding id${unknownIgnored.length === 1 ? '' : 's'}: ${unknownIgnored.map(id => `"${id}"`).join(', ')}. Check for typos.`);

	return `${lines.join('\n')}\n`;
}

// --- helpers ---

function missingFile(catalog: ReturnType<typeof buildCatalog>, dest: string, message: string, id = `missing-${basename(dest)}`): Finding {
	const unit = unitForDest(catalog, dest);
	return { id, message, fix: fixForUnit(unit, `Add ${dest}.`), unit };
}

function missingScript(catalog: ReturnType<typeof buildCatalog>, script: string, id: string, message: string): Finding {
	const unit = unitForScript(catalog, script);
	return { id, message, fix: fixForUnit(unit, `Add a "${script}" script to package.json.`), unit };
}

function fixForUnit(unit: UnitId | undefined, fallback: string): string {
	return unit ? `Run \`unbranded --units ${unit}\` to add it.` : fallback;
}

// Faithful to the public catalog rather than the raw manifest: a finding names a
// unit only if the catalog advertises a file writing that destination.
function unitForDest(catalog: ReturnType<typeof buildCatalog>, dest: string): UnitId | undefined {
	return catalog.units.find(u => u.files.some(f => effectiveDest(f) === dest))?.id;
}

function unitForScript(catalog: ReturnType<typeof buildCatalog>, script: string): UnitId | undefined {
	return catalog.units.find(u => u.packageJsonPatch?.scripts && script in u.packageJsonPatch.scripts)?.id;
}

// For units whose fix isn't discoverable by a destination file — core-node-version
// computes its output instead of shipping a template, so it has no catalog dest.
// Verifies the id is really in the catalog rather than trusting a bare string.
function unitForId(catalog: ReturnType<typeof buildCatalog>, id: UnitId): UnitId | undefined {
	return catalog.units.find(u => u.id === id)?.id;
}

// `rename` swaps the basename while keeping dest's directory, so the file that
// actually lands is the renamed one.
function effectiveDest(file: CatalogUnit['files'][number]): string {
	if (!file.rename)
		return file.dest;
	const slash = file.dest.lastIndexOf('/');
	return slash === -1 ? file.rename : `${file.dest.slice(0, slash)}/${file.rename}`;
}

function hasCiWorkflow(cwd: string): boolean {
	if (existsSync(join(cwd, '.gitlab-ci.yml')) || existsSync(join(cwd, '.circleci', 'config.yml')))
		return true;
	const workflows = join(cwd, '.github', 'workflows');
	if (!existsSync(workflows))
		return false;
	try {
		return readdirSync(workflows).some(f => /\.ya?ml$/.test(f));
	}
	catch {
		return false;
	}
}

function hasNodeVersionPin(cwd: string, pkg: PackageJson): boolean {
	return Boolean(engines(pkg)?.node) || existsSync(join(cwd, '.nvmrc')) || typeof pkg.packageManager === 'string';
}

function hasScript(pkg: PackageJson, name: string): boolean {
	const scripts = record(pkg.scripts);
	return typeof scripts?.[name] === 'string';
}

function dep(pkg: PackageJson, name: string): boolean {
	return Boolean(record(pkg.dependencies)?.[name]) || Boolean(record(pkg.devDependencies)?.[name]);
}

function engines(pkg: PackageJson): Record<string, unknown> | undefined {
	return record(pkg.engines);
}

function parsePackageManagerPm(field: unknown): Pm | undefined {
	if (typeof field !== 'string')
		return undefined;
	const match = /^(pnpm|yarn|npm|bun)@/.exec(field);
	return match?.[1] as Pm | undefined;
}

function nodeVersionMismatch(cwd: string, pkg: PackageJson): { engines: string; nvmrc: string } | undefined {
	const enginesNode = engines(pkg)?.node;
	const nvmrcPath = join(cwd, '.nvmrc');
	if (typeof enginesNode !== 'string' || !existsSync(nvmrcPath))
		return undefined;
	const nvmrcRaw = readFileSync(nvmrcPath, 'utf-8').trim();
	const enginesMajor = majorOf(enginesNode);
	const nvmrcMajor = majorOf(nvmrcRaw);
	// Only flag when both pin a concrete, differing major. A non-numeric .nvmrc
	// (e.g. `lts/hydrogen`) isn't comparable, so leave it alone rather than guess.
	if (enginesMajor === undefined || nvmrcMajor === undefined || enginesMajor === nvmrcMajor)
		return undefined;
	return { engines: enginesNode, nvmrc: nvmrcRaw };
}

function majorOf(spec: string): number | undefined {
	const match = /(\d+)/.exec(spec);
	return match?.[1] ? Number(match[1]) : undefined;
}

function record(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function basename(dest: string): string {
	const slash = dest.lastIndexOf('/');
	return slash === -1 ? dest : dest.slice(slash + 1);
}
