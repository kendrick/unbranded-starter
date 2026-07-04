import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// The narrow, publicly-shared package.json reader. pm.ts has its own private
// reader that throws on malformed JSON, which is right for detection (a bad
// manifest should abort a scaffold), but wrong for `doctor`, whose whole job is
// to report problems rather than crash on them. So this one never throws: a
// malformed manifest comes back as a result the audit can turn into a finding.
export interface PackageJson {
	name?: string;
	version?: string;
	packageManager?: string;
	engines?: Record<string, string>;
	scripts?: Record<string, string>;
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
	[key: string]: unknown;
}

export type PackageJsonRead
	= | { kind: 'ok'; pkg: PackageJson }
		| { kind: 'missing' }
		| { kind: 'malformed'; error: string };

export function readPackageJson(dir: string): PackageJsonRead {
	const path = join(dir, 'package.json');
	if (!existsSync(path))
		return { kind: 'missing' };
	try {
		return { kind: 'ok', pkg: JSON.parse(readFileSync(path, 'utf-8')) as PackageJson };
	}
	catch (err) {
		return { kind: 'malformed', error: (err as Error).message };
	}
}
