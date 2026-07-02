import type { Pm } from '../detect/pm';
import type { MergeInput } from '../fs/merge-json';
import type { Unit } from '../manifest/types';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { spinner } from '@clack/prompts';
import { mergePackageJson } from '../fs/merge-json';
import { spawnOptions } from './spawn';

export interface WriteAndInstallOpts {
	targetDir: string;
	pm: Pm | null;
	units: Unit[];
}

export interface WriteAndInstallResult {
	wrote: boolean;
	installed: boolean;
	cancelled: boolean;
	error?: string;
}

export async function writeAndInstall(opts: WriteAndInstallOpts): Promise<WriteAndInstallResult> {
	const pkgPath = join(opts.targetDir, 'package.json');
	const had = existsSync(pkgPath);
	const raw = had ? readFileSync(pkgPath, 'utf-8') : '';

	// Seed a minimal package.json for new-project mode. `name` defaults to the
	// directory's basename, which matches what `npm init -y` does.
	const existing: Record<string, unknown> = had
		? (JSON.parse(raw) as Record<string, unknown>)
		: { name: basename(opts.targetDir), version: '0.0.0', type: 'module' };

	const indent = had ? detectIndent(raw) : '  ';

	const patches: MergeInput[] = opts.units.map(u => ({
		dependencies: u.dependencies,
		devDependencies: u.devDependencies,
		scripts: u.packageJsonPatch?.scripts,
		engines: u.packageJsonPatch?.engines,
	}));

	const merged = mergePackageJson(existing, patches);
	writeFileSync(pkgPath, `${JSON.stringify(merged, null, indent)}\n`);

	if (!opts.pm) {
		return { wrote: true, installed: false, cancelled: false };
	}

	const s = spinner();
	s.start(`Installing dependencies via ${opts.pm}`);
	const result = await runInstall(opts.targetDir, opts.pm);

	if (result.cancelled) {
		s.stop('Install interrupted.');
		return { wrote: true, installed: false, cancelled: true };
	}
	if (result.success) {
		s.stop('Dependencies installed.');
		return { wrote: true, installed: true, cancelled: false };
	}
	s.stop(`Install failed (exit ${result.code}).`);
	return { wrote: true, installed: false, cancelled: false, error: result.error };
}

// Match the existing file's indentation so we don't reformat what the user
// (or a prior tool) chose. Defaults to two spaces, which is what `npm init`
// emits and what most package.json files in the wild use.
function detectIndent(content: string): string {
	for (const line of content.split('\n')) {
		const match = /^([ \t]+)\S/.exec(line);
		if (match?.[1])
			return match[1];
	}
	return '  ';
}

interface InstallResult {
	success: boolean;
	code: number;
	cancelled: boolean;
	error?: string;
}

function runInstall(cwd: string, pm: Pm): Promise<InstallResult> {
	return new Promise((resolve) => {
		const child = spawn(pm, ['install'], spawnOptions(cwd));
		let cancelled = false;

		// Catch Ctrl-C while install is running. Send SIGTERM first for a clean
		// shutdown; escalate to SIGKILL after a grace period if the PM ignores
		// it. The .unref() lets the process exit before the timer fires when
		// the child does shut down cleanly.
		const onSigint = (): void => {
			cancelled = true;
			child.kill('SIGTERM');
			setTimeout(() => {
				if (!child.killed)
					child.kill('SIGKILL');
			}, 5000).unref();
		};
		process.on('SIGINT', onSigint);

		child.on('exit', (code) => {
			process.off('SIGINT', onSigint);
			resolve({
				success: code === 0,
				code: code ?? 1,
				cancelled,
			});
		});

		child.on('error', (err) => {
			process.off('SIGINT', onSigint);
			resolve({
				success: false,
				code: 1,
				cancelled,
				error: err.message,
			});
		});
	});
}
