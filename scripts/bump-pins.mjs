// Maintainer-side half of the freshness policy (#35): consume `unbranded
// outdated --json`, rewrite the pin literals in the manifest sources and this
// repo's own package.json (the manifest pins what we ship, package.json pins
// what we build with, and both have to move together), and open
// one `bump/weekly` PR with every unit's bumps and squash auto-merge on, so a
// green week lands untouched (#272). `--per-unit` falls back to one
// `bump/<unit>` PR per unit, each gated by that unit's own e2e, for a red week
// where pin-health repairs units one at a time. Runs from the weekly workflow
// (.github/workflows/pin-bumps.yml) or by hand:
//
//   node dist/cli.js outdated --json > /tmp/outdated.json
//   node scripts/bump-pins.mjs /tmp/outdated.json [--dry-run] [--per-unit]
//
// The pure pieces (planBumps, groupByUnit, rewritePins, rewritePackageJson)
// are unit-tested directly; main() is covered by running the script against a
// scratch repo with a fake gh. --dry-run bypasses the git/gh glue entirely.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';

// Every manifest file that carries version pins. None of them is in the unit
// registry, so all three get the rewrite. eslint's pins live in the flavor
// tables of eslint-config.ts. The oxc toolchain's (oxlint, oxfmt,
// oxlint-tsgolint) live in OXC_DEV_DEPENDENCIES in oxlint-config.ts.
// package.json is handled separately (rewritePackageJson)—it's not a manifest
// source and its misses aren't a build-breaking signal the way a missing
// manifest pin is, so it stays out of this list and out of the missed-union
// hard-fail below.
// pin-health-controller.mjs imports this to skip the grouped PR, which it can't repair per unit.
export const GROUPED_HEAD = 'bump/weekly';

export const MANIFEST_FILES = [
	'src/manifest/index.ts',
	'src/manifest/eslint-config.ts',
	'src/manifest/oxlint-config.ts',
];

const majorOf = (spec) => /^[\^~]?(\d+)\./.exec(spec)?.[1];

// outdated's JSON → the actionable subset: anything the registry is ahead of.
// `unknown` grades stay out — a pin the tool can't parse is a human's problem.
export function planBumps(report) {
	return (
		report.packages
			.filter((p) => p.behind === 'patch' || p.behind === 'minor' || p.behind === 'major')
			// A held entry whose latest left its line is a report from an older CLI or
			// a hand edit; bumping it is the exact #131 break, so drop it.
			.filter((p) => p.line === undefined || Number(majorOf(p.latest)) === p.line)
			.map((p) => ({ name: p.name, from: p.pin, to: p.latest, units: p.units }))
	);
}

// One PR per unit. A pin shared across units lands in the FIRST declarer's PR
// (pins are identical by construction, so any owner works; two PRs bumping the
// same line would just conflict).
export function groupByUnit(bumps) {
	const groups = new Map();
	for (const bump of bumps) {
		const unit = bump.units[0] ?? 'unattributed';
		const list = groups.get(unit) ?? [];
		list.push(bump);
		groups.set(unit, list);
	}
	return groups;
}

// String-targeted rewrite of `name: 'from'` pin literals, quoted or bare keys,
// every occurrence. The leading boundary keeps `eslint:` from matching inside
// `my-eslint:`. A bump that matches nothing is reported as missed — the
// manifest moved since outdated ran, and automation must fail loudly rather
// than open a PR that bumps nothing.
export function rewritePins(source, bumps) {
	const applied = [];
	const missed = [];
	let out = source;
	for (const { name, from, to } of bumps) {
		const n = escapeRegExp(name);
		const pattern = new RegExp(
			`(^|[^\\w@/.-])((?:'${n}'|"${n}"|${n}):\\s*')${escapeRegExp(from)}(')`,
			'g',
		);
		let hit = false;
		out = out.replace(pattern, (_m, pre, key, quote) => {
			hit = true;
			return `${pre}${key}${to}${quote}`;
		});
		(hit ? applied : missed).push(name);
	}
	return { source: out, applied, missed };
}

// package.json can't go through rewritePins: it's double-quoted where the
// manifest sources are single-quoted, and its ranges carry a `^`/`~` prefix
// the manifest's exact pins never do—an exact `from` match would never hit.
// So this keys on `name` and lets JSON.parse settle both what's present and
// the exact current range string, then splices only that substring back into
// the raw text. That's what keeps tab indentation and key order byte-for-byte
// outside the version itself, and it's why the rewrite fires independent of
// whether the existing range would already admit `to`—a caret range often
// would, and letting that suppress the bump is how a major-version gap hides.
// The one exception: a range on neither the bump's `from` major nor its `to`
// major is left alone (see the guard below).
export function rewritePackageJson(source, bumps) {
	const applied = [];
	const missed = [];
	let out = source;
	const pkg = JSON.parse(source);
	for (const { name, from, to } of bumps) {
		let hit = false;
		for (const map of ['dependencies', 'devDependencies']) {
			const current = pkg[map]?.[name];
			if (current === undefined) continue;
			// Two TS pins share one package.json key, so a bump may only move a range
			// on its own `from` or `to` major. Else the 7.x bump drags the repo's ^6
			// onto TS 7 (#131). `to` counts too: a root already on the target major
			// (^9.2.0 when the manifest goes 8.x→9.3.0) must still advance with it.
			const fromMajor = majorOf(from);
			const toMajor = majorOf(to);
			const currentMajor = majorOf(current);
			if (
				fromMajor !== undefined &&
				currentMajor !== undefined &&
				currentMajor !== fromMajor &&
				currentMajor !== toMajor
			) {
				continue;
			}
			// The repo mixes range styles per entry (ajv pins exact) so the
			// prefix has to be read off this entry, not assumed.
			const prefix = /^[\^~]/.test(current) ? current[0] : '';
			const pattern = new RegExp(`("${escapeRegExp(name)}":\\s*")${escapeRegExp(current)}(")`, 'g');
			out = out.replace(pattern, (_m, pre, post) => `${pre}${prefix}${to}${post}`);
			hit = true;
		}
		(hit ? applied : missed).push(name);
	}
	return { source: out, applied, missed };
}

// The pin-health loop (.github/control-loops/pin-health.md) repairs a red bump on its own `pin-health/<unit>` branch. This script rebuilds `bump/<unit>` from main and force-pushes it every week, so while that repair PR is open the unit sits out, and the bump rides the repair PR instead.
// A grouped run also sits out a unit whose per-unit `bump/<unit>` PR from a fallback week is still open, so one bump per unit is in flight. Per-unit mode can't, since that PR is the one it refreshes.
export function skipLoopUnits(groups, openHeads, { grouped = false } = {}) {
	const heads = new Set(openHeads);
	const kept = new Map();
	const skipped = [];
	for (const [unit, bumps] of groups) {
		if (heads.has(`pin-health/${unit}`) || (grouped && heads.has(`bump/${unit}`)))
			skipped.push(unit);
		else kept.set(unit, bumps);
	}
	return { kept, skipped };
}

function escapeRegExp(text) {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sh(command, args, opts = {}) {
	return execFileSync(command, args, { encoding: 'utf-8', ...opts });
}

const missedLine = (head, missed) =>
	`${head}: no pin literal found for ${[...missed].join(', ')} — manifest moved since outdated ran?\n`;

// Every unit's rewrite runs over the sources the previous unit left, so two units touching one file both land. A unit with a missed pin drops out whole and the rest still ship (#218). Returns whether anything failed.
function bumpGrouped(groups, { dryRun, base, openPr }) {
	let failed = false;
	let sources = new Map(MANIFEST_FILES.map((path) => [path, readFileSync(path, 'utf-8')]));
	const hits = new Map(MANIFEST_FILES.map((path) => [path, []]));
	const kept = [];
	for (const [unit, bumps] of groups) {
		const next = new Map();
		const applied = new Map();
		const missed = new Set(bumps.map((b) => b.name));
		for (const [path, source] of sources) {
			const result = rewritePins(source, bumps);
			next.set(path, result.source);
			applied.set(path, result.applied);
			for (const name of result.applied) missed.delete(name);
		}
		if (missed.size > 0) {
			process.stderr.write(missedLine(`bump/${unit}`, missed));
			failed = true;
			continue;
		}
		sources = next;
		for (const [path, names] of applied) hits.get(path).push(...names);
		kept.push([unit, bumps]);
	}
	if (kept.length === 0) return failed;

	const all = kept.flatMap(([, bumps]) => bumps);
	const line = (b) => `${b.name} ${b.from} → ${b.to}`;
	const pkgResult = rewritePackageJson(readFileSync('package.json', 'utf-8'), all);

	if (dryRun) {
		process.stdout.write(`${GROUPED_HEAD}\n`);
		for (const [unit, bumps] of kept)
			process.stdout.write(`  ${unit}\n${bumps.map((b) => `    ${line(b)}\n`).join('')}`);
		for (const [path, names] of hits)
			process.stdout.write(`  ${path}: ${names.length > 0 ? names.join(', ') : '(none)'}\n`);
		process.stdout.write(
			`  package.json: ${pkgResult.applied.length > 0 ? pkgResult.applied.join(', ') : '(none)'}\n`,
		);
		return failed;
	}

	sh('git', ['checkout', '-B', GROUPED_HEAD, base]);
	for (const [path, source] of sources) writeFileSync(path, source);
	if (pkgResult.applied.length > 0) {
		writeFileSync('package.json', pkgResult.source);
		sh('pnpm', ['install', '--lockfile-only']);
	}
	// main only takes squash merges, so one commit is all that survives anyway.
	const title = 'fix(manifest): bump pins (weekly)';
	sh('git', ['commit', '-am', `${title}\n\n${all.map(line).join('\n')}`]);
	sh('git', ['push', '-f', 'origin', GROUPED_HEAD]);
	// One `- name from → to` line per pin, the shape parseBumpLines in pin-health-controller.mjs reads.
	const sections = kept.map(
		([unit, bumps]) => `### ${unit}\n\n${bumps.map((b) => `- ${line(b)}`).join('\n')}`,
	);
	const body = `Weekly pin refresh from \`unbranded outdated --json\`. Merge gate is CI; auto-merge is on.\n\n${sections.join('\n\n')}`;
	if (!openPr(GROUPED_HEAD, title, body, all.length)) failed = true;
	sh('git', ['checkout', base]);
	return failed;
}

function main() {
	const [, , jsonPath, ...flags] = process.argv;
	if (!jsonPath) {
		process.stderr.write(
			'Usage: node scripts/bump-pins.mjs <outdated.json> [--dry-run] [--per-unit]\n',
		);
		process.exit(1);
	}
	const dryRun = flags.includes('--dry-run');
	const perUnit = flags.includes('--per-unit');

	const report = JSON.parse(readFileSync(jsonPath, 'utf-8'));
	// A dry run stays offline, so it can't see open PRs and plans every unit.
	const openHeads = dryRun
		? []
		: JSON.parse(
				sh('gh', ['pr', 'list', '--state', 'open', '--limit', '100', '--json', 'headRefName']),
			).map((p) => p.headRefName);
	const { kept: groups, skipped } = skipLoopUnits(groupByUnit(planBumps(report)), openHeads, {
		grouped: !perUnit,
	});
	for (const unit of skipped)
		process.stdout.write(
			openHeads.includes(`pin-health/${unit}`)
				? `bump/${unit}: skipped while pin-health/${unit} is open.\n`
				: `${unit}: skipped while bump/${unit} is open.\n`,
		);
	if (groups.size === 0) {
		process.stdout.write(
			skipped.length > 0 ? 'Nothing else to bump.\n' : 'All pins current; nothing to bump.\n',
		);
		return;
	}

	// Every unit branch starts from the same base, not from the previous bump
	// branch, so the PRs stay independent and merge in any order.
	const base = dryRun ? '' : sh('git', ['rev-parse', 'HEAD']).trim();
	let failed = false;

	// Shared by both modes. A refreshed PR may predate auto-merge, so it gets the call too, and a failed call fails the job, because a quiet success here repeats the #218 failure.
	function openPr(branch, title, body, pins) {
		try {
			sh('gh', [
				'pr',
				'create',
				'--title',
				title,
				'--base',
				'main',
				'--head',
				branch,
				'--body',
				body,
			]);
			process.stdout.write(`Opened PR for ${branch} (${pins} pin${pins === 1 ? '' : 's'}).\n`);
		} catch (err) {
			// Only gh's own "already exists" means the force-push refreshed an open PR;
			// a bad token or an outage must fail the job, not read as success (#218).
			if (/already exists/.test(String(err.stderr))) {
				process.stdout.write(`PR for ${branch} already open; branch refreshed.\n`);
			} else {
				process.stderr.write(
					`${branch}: gh pr create failed: ${String(err.stderr ?? err.message).trim()}\n`,
				);
				return false;
			}
		}
		try {
			sh('gh', ['pr', 'merge', branch, '--auto', '--squash']);
		} catch (err) {
			process.stderr.write(
				`${branch}: enabling auto-merge failed: ${String(err.stderr ?? err.message).trim()}\n`,
			);
			return false;
		}
		return true;
	}

	if (!perUnit) failed = bumpGrouped(groups, { dryRun, base, openPr });
	else
		for (const [unit, bumps] of groups) {
			const lines = bumps.map((b) => `${b.name} ${b.from} → ${b.to}`);

			if (dryRun) {
				// Runs both rewrites in memory so a dry run surfaces the same
				// per-file misses the real run would, without writing anything.
				process.stdout.write(`bump/${unit}\n${lines.map((l) => `  ${l}`).join('\n')}\n`);
				const missed = new Set(bumps.map((b) => b.name));
				for (const path of MANIFEST_FILES) {
					const result = rewritePins(readFileSync(path, 'utf-8'), bumps);
					for (const name of result.applied) missed.delete(name);
					process.stdout.write(
						`  ${path}: ${result.applied.length > 0 ? result.applied.join(', ') : '(none)'}\n`,
					);
				}
				const pkgResult = rewritePackageJson(readFileSync('package.json', 'utf-8'), bumps);
				process.stdout.write(
					`  package.json: ${pkgResult.applied.length > 0 ? pkgResult.applied.join(', ') : '(none)'}\n`,
				);
				if (missed.size > 0) {
					process.stderr.write(missedLine(`bump/${unit}`, missed));
					failed = true;
				}
				continue;
			}

			const branch = `bump/${unit}`;
			sh('git', ['checkout', '-B', branch, base]);

			// Rewrite in memory and write only once nothing is missed: `git checkout`
			// carries uncommitted edits, so a refused unit's partial bump on disk would
			// ride into the next unit's `commit -am` (#218).
			const missed = new Set(bumps.map((b) => b.name));
			const rewrites = [];
			for (const path of MANIFEST_FILES) {
				const result = rewritePins(readFileSync(path, 'utf-8'), bumps);
				rewrites.push([path, result.source]);
				for (const name of result.applied) missed.delete(name);
			}
			if (missed.size > 0) {
				process.stderr.write(missedLine(`bump/${unit}`, missed));
				failed = true;
				sh('git', ['checkout', base]);
				continue;
			}
			for (const [path, source] of rewrites) writeFileSync(path, source);

			// package.json is an opportunistic extra target, not a manifest source:
			// its misses are expected (turbo, husky, @playwright/test carry no
			// devDependencies counterpart) and do not set `failed` above.
			const pkgResult = rewritePackageJson(readFileSync('package.json', 'utf-8'), bumps);
			if (pkgResult.applied.length > 0) {
				writeFileSync('package.json', pkgResult.source);
				// CI installs with --frozen-lockfile, so a package.json bump with
				// no matching pnpm-lock.yaml update would open a PR that can't
				// pass its own gate. `git commit -am` below already stages the
				// tracked lockfile this produces.
				sh('pnpm', ['install', '--lockfile-only']);
			}

			const title = `fix(manifest): bump ${unit} pins`;
			sh('git', ['commit', '-am', `${title}\n\n${lines.join('\n')}`]);
			sh('git', ['push', '-f', 'origin', branch]);
			const body = `Weekly pin refresh for ${unit}, from \`unbranded outdated --json\`. Merge gate is this unit's own CI; auto-merge is on.\n\n${lines.map((l) => `- ${l}`).join('\n')}`;
			if (!openPr(branch, title, body, bumps.length)) failed = true;
			sh('git', ['checkout', base]);
		}

	if (failed) process.exit(1);
}

// Import-safe: vitest pulls the pure functions without running the git glue.
if (process.argv[1]?.endsWith('bump-pins.mjs')) main();
