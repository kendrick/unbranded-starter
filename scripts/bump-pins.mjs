// Maintainer-side half of the freshness policy (#35): consume `unbranded
// outdated --json`, rewrite the pin literals in the manifest sources, and open
// one PR per unit so each bump is gated by that unit's own e2e. Runs from the
// weekly workflow (.github/workflows/pin-bumps.yml) or by hand:
//
//   node dist/cli.js outdated --json > /tmp/outdated.json
//   node scripts/bump-pins.mjs /tmp/outdated.json [--dry-run]
//
// The pure pieces (planBumps, groupByUnit, rewritePins) are unit-tested; main()
// is thin git/gh glue that --dry-run bypasses entirely.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';

// Every file that carries version pins. eslint's live in the flavor tables of
// eslint-config.ts, not the unit registry, so both files get the rewrite.
const MANIFEST_FILES = ['src/manifest/index.ts', 'src/manifest/eslint-config.ts'];

// outdated's JSON → the actionable subset: anything the registry is ahead of.
// `unknown` grades stay out — a pin the tool can't parse is a human's problem.
export function planBumps(report) {
	return report.packages
		.filter(p => p.behind === 'patch' || p.behind === 'minor' || p.behind === 'major')
		.map(p => ({ name: p.name, from: p.pin, to: p.latest, units: p.units }));
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
		const pattern = new RegExp(`(^|[^\\w@/.-])((?:'${n}'|"${n}"|${n}):\\s*')${escapeRegExp(from)}(')`, 'g');
		let hit = false;
		out = out.replace(pattern, (_m, pre, key, quote) => {
			hit = true;
			return `${pre}${key}${to}${quote}`;
		});
		(hit ? applied : missed).push(name);
	}
	return { source: out, applied, missed };
}

function escapeRegExp(text) {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sh(command, args, opts = {}) {
	return execFileSync(command, args, { encoding: 'utf-8', ...opts });
}

function main() {
	const [, , jsonPath, ...flags] = process.argv;
	if (!jsonPath) {
		process.stderr.write('Usage: node scripts/bump-pins.mjs <outdated.json> [--dry-run]\n');
		process.exit(1);
	}
	const dryRun = flags.includes('--dry-run');

	const report = JSON.parse(readFileSync(jsonPath, 'utf-8'));
	const groups = groupByUnit(planBumps(report));
	if (groups.size === 0) {
		process.stdout.write('All pins current; nothing to bump.\n');
		return;
	}

	// Every unit branch starts from the same base, not from the previous bump
	// branch, so the PRs stay independent and merge in any order.
	const base = dryRun ? '' : sh('git', ['rev-parse', 'HEAD']).trim();
	let missedAny = false;

	for (const [unit, bumps] of groups) {
		const lines = bumps.map(b => `${b.name} ${b.from} → ${b.to}`);
		if (dryRun) {
			process.stdout.write(`bump/${unit}\n${lines.map(l => `  ${l}`).join('\n')}\n`);
			continue;
		}

		const branch = `bump/${unit}`;
		sh('git', ['checkout', '-B', branch, base]);

		const missed = new Set(bumps.map(b => b.name));
		for (const path of MANIFEST_FILES) {
			const result = rewritePins(readFileSync(path, 'utf-8'), bumps);
			writeFileSync(path, result.source);
			for (const name of result.applied) missed.delete(name);
		}
		if (missed.size > 0) {
			process.stderr.write(`bump/${unit}: no pin literal found for ${[...missed].join(', ')} — manifest moved since outdated ran?\n`);
			missedAny = true;
			sh('git', ['checkout', base]);
			continue;
		}

		const title = `fix(manifest): bump ${unit} pins`;
		sh('git', ['commit', '-am', `${title}\n\n${lines.join('\n')}`]);
		sh('git', ['push', '-f', 'origin', branch]);
		try {
			sh('gh', ['pr', 'create', '--title', title, '--base', 'main', '--head', branch, '--body', `Weekly pin refresh for ${unit}, from \`unbranded outdated --json\`. Merge gate is this unit's own CI.\n\n${lines.map(l => `- ${l}`).join('\n')}`]);
			process.stdout.write(`Opened PR for ${branch} (${bumps.length} pin${bumps.length === 1 ? '' : 's'}).\n`);
		}
		catch {
			// Branch force-pushed into an existing PR: the PR is already refreshed.
			process.stdout.write(`PR for ${branch} already open; branch refreshed.\n`);
		}
		sh('git', ['checkout', base]);
	}

	if (missedAny)
		process.exit(1);
}

// Import-safe: vitest pulls the pure functions without running the git glue.
if (process.argv[1]?.endsWith('bump-pins.mjs'))
	main();
