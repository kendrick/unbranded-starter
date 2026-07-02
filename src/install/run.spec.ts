import type { Unit } from '../manifest/types';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeAndInstall } from './run';

const UNIT: Unit = {
	id: 'core-eslint',
	category: 'lint',
	label: 'ESLint',
	description: '',
	files: [],
	dependencies: { clsx: '2.1.1' },
	devDependencies: { eslint: '9.39.4', typescript: '5.9.3' },
};

describe('writeAndInstall version policy', () => {
	let tmp: string;

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-run-'));
	});

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	function writtenPkg(): { dependencies: Record<string, string>; devDependencies: Record<string, string> } {
		return JSON.parse(readFileSync(join(tmp, 'package.json'), 'utf-8'));
	}

	it('keeps the manifest pins by default', async () => {
		// pm:null means it writes package.json and skips the install spawn.
		await writeAndInstall({ targetDir: tmp, pm: null, units: [UNIT] });
		expect(writtenPkg().devDependencies).toMatchObject({ eslint: '9.39.4', typescript: '5.9.3' });
		expect(writtenPkg().dependencies).toMatchObject({ clsx: '2.1.1' });
	});

	it('rewrites every dependency to the latest tag when latest is set', async () => {
		await writeAndInstall({ targetDir: tmp, pm: null, units: [UNIT], latest: true });
		expect(writtenPkg().devDependencies).toEqual({ eslint: 'latest', typescript: 'latest' });
		expect(writtenPkg().dependencies).toEqual({ clsx: 'latest' });
	});
});
