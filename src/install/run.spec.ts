import type { Unit } from '../manifest/types';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeAndInstall } from './run';

const NODE_MAJOR = process.versions.node.split('.')[0];

const NODE_UNIT: Unit = {
	id: 'core-node-version',
	category: 'foundation',
	label: 'Node version',
	description: '',
	files: [],
};

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

	it('pins .nvmrc and engines from the running node major when core-node-version is selected', async () => {
		// pm:null means no install spawn and no packageManager query, so the pin
		// is node-only — exactly the "no package.json to detect a pm from" case.
		await writeAndInstall({ targetDir: tmp, pm: null, units: [NODE_UNIT] });
		expect(readFileSync(join(tmp, '.nvmrc'), 'utf-8')).toBe(`${NODE_MAJOR}\n`);
		const pkg = JSON.parse(readFileSync(join(tmp, 'package.json'), 'utf-8'));
		expect(pkg.engines).toEqual({ node: `>=${NODE_MAJOR}` });
		expect(pkg.packageManager).toBeUndefined();
	});

	it('never clobbers an existing .nvmrc', async () => {
		writeFileSync(join(tmp, '.nvmrc'), '18\n');
		await writeAndInstall({ targetDir: tmp, pm: null, units: [NODE_UNIT] });
		expect(readFileSync(join(tmp, '.nvmrc'), 'utf-8')).toBe('18\n');
	});

	it('leaves .nvmrc alone when core-node-version is not selected', async () => {
		await writeAndInstall({ targetDir: tmp, pm: null, units: [UNIT] });
		expect(existsSync(join(tmp, '.nvmrc'))).toBe(false);
	});
});

const VSCODE_UNIT: Unit = { id: 'opt-vscode', category: 'editor', label: 'VS Code', description: '', files: [] };
const ESLINT_REC: Unit = { ...UNIT, recommendedExtensions: ['dbaeumer.vscode-eslint'] };
const EDITORCONFIG_REC: Unit = {
	id: 'core-editorconfig',
	category: 'foundation',
	label: '',
	description: '',
	files: [],
	recommendedExtensions: ['editorconfig.editorconfig'],
};

describe('writeAndInstall vscode extensions', () => {
	let tmp: string;

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), 'unbranded-run-vscode-'));
	});

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	function readExtensions(): { recommendations: string[]; [k: string]: unknown } {
		return JSON.parse(readFileSync(join(tmp, '.vscode', 'extensions.json'), 'utf-8'));
	}

	it('generates .vscode/extensions.json from the selected units when opt-vscode is chosen', async () => {
		await writeAndInstall({ targetDir: tmp, pm: null, units: [VSCODE_UNIT, ESLINT_REC, EDITORCONFIG_REC] });
		expect(readExtensions().recommendations).toEqual([
			'dbaeumer.vscode-eslint',
			'editorconfig.editorconfig',
		]);
	});

	it('unions into an existing extensions.json without clobbering its entries or sibling keys', async () => {
		mkdirSync(join(tmp, '.vscode'), { recursive: true });
		writeFileSync(
			join(tmp, '.vscode', 'extensions.json'),
			`${JSON.stringify({ recommendations: ['acme.custom'], unwantedRecommendations: ['bad.ext'] }, null, '\t')}\n`,
		);
		await writeAndInstall({ targetDir: tmp, pm: null, units: [VSCODE_UNIT, ESLINT_REC] });
		const ext = readExtensions();
		expect(ext.recommendations).toEqual(['acme.custom', 'dbaeumer.vscode-eslint']);
		// A sibling key the user maintains must survive the computed rewrite.
		expect(ext.unwantedRecommendations).toEqual(['bad.ext']);
	});

	it('writes nothing when opt-vscode is not selected', async () => {
		await writeAndInstall({ targetDir: tmp, pm: null, units: [ESLINT_REC] });
		expect(existsSync(join(tmp, '.vscode', 'extensions.json'))).toBe(false);
	});
});
