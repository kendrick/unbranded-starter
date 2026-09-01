import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { collectManifestPins } from '../commands/outdated';
import { PKG_ROOT } from '../util/paths';
import { UNITS } from './index';

// This repo scaffolds config it also runs on itself: every manifest pin names
// a devDependency version this repo's own tooling should be exercising. When
// the two drift by a major, the scaffolded projects are running code this repo
// never tests against, and the dogfooding claim goes silent. pnpm's strict
// node_modules layout means only direct dependencies resolve at the root, so
// a pin with no installed package here is simply not one of this repo's own
// devDependencies—not a drift.
describe('manifest pins match this repo\'s own installed majors', () => {
	it('every exact manifest pin resolves to the same major as node_modules', () => {
		const mismatches: string[] = [];

		for (const { name, pin } of collectManifestPins(UNITS)) {
			const pinMatch = /^(\d+)\.\d+\.\d+$/.exec(pin);
			if (!pinMatch)
				continue;
			const pinMajor = pinMatch[1];

			const installedPkgPath = join(PKG_ROOT, 'node_modules', name, 'package.json');
			if (!existsSync(installedPkgPath))
				continue;

			const installed = JSON.parse(readFileSync(installedPkgPath, 'utf-8')) as { version?: string };
			const installedMatch = /^(\d+)\.\d+\.\d+/.exec(installed.version ?? '');
			if (!installedMatch)
				continue;
			const installedMajor = installedMatch[1];

			if (installedMajor !== pinMajor)
				mismatches.push(`${name}: manifest pins ${pin}, node_modules has ${installed.version}`);
		}

		expect(mismatches).toEqual([]);
	});
});
