// @vitest-environment node
// spawn mocking only hooks the main-realm loader; see init.install-failure.spec.ts.
import type { ChildProcess } from 'node:child_process';
import type { AnyUnit } from '../manifest/types';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { runPostInstalls } from './post';

vi.mock('node:child_process', async (importOriginal) => {
	const actual = await importOriginal<typeof import('node:child_process')>();
	return { ...actual, spawn: vi.fn() };
});

// A hook that runs until it's killed, so the SIGINT lands mid-hook.
function hangingChild(): ChildProcess {
	const child = new EventEmitter() as unknown as ChildProcess;
	Object.assign(child, {
		killed: false,
		kill: vi.fn(() => {
			queueMicrotask(() => child.emit('exit', null));
			return true;
		}),
	});
	return child;
}

describe('runPostInstalls on SIGINT (#217)', () => {
	it('stops before the next hook when one is interrupted', async () => {
		vi.mocked(spawn).mockImplementation(() => hangingChild());
		const unit = {
			id: 'u',
			files: [],
			postInstall: [
				{ id: 'slow', prompt: 'slow?', default: true, command: ['sleep', '3'] },
				{ id: 'second', prompt: 'second?', default: true, command: ['true'] },
			],
		} as unknown as AnyUnit;

		const running = runPostInstalls({ targetDir: '.', pm: 'pnpm', units: [unit], auto: 'all' });
		await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(1));
		process.emit('SIGINT');
		const summary = await running;

		expect(spawn).toHaveBeenCalledTimes(1);
		expect(summary.ran).not.toContain('second');
		expect(summary.failed.map((f) => f.id)).not.toContain('second');
		expect(summary.cancelled).toBe(true);
	});
});
