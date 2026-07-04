import { describe, expect, it } from 'vitest';
import { computeNodeVersion } from './node-version';

describe('computeNodeVersion', () => {
	it('pins .nvmrc and engines to the running node major from one source', () => {
		const nv = computeNodeVersion({ nodeVersion: '24.13.0', pm: 'pnpm', pmVersion: '10.0.0' });
		// The whole point of the unit: .nvmrc and engines can never disagree
		// because both fall out of the same major.
		expect(nv.nvmrc).toBe('24\n');
		expect(nv.engines).toEqual({ node: '>=24' });
	});

	it('writes packageManager as a real pm@version when both are known', () => {
		const nv = computeNodeVersion({ nodeVersion: '22.9.0', pm: 'pnpm', pmVersion: '10.0.0' });
		expect(nv.packageManager).toBe('pnpm@10.0.0');
	});

	it('omits packageManager rather than guess when no pm is detected', () => {
		const nv = computeNodeVersion({ nodeVersion: '22.9.0', pm: null, pmVersion: null });
		expect(nv.packageManager).toBeUndefined();
	});

	it('omits packageManager when the pm version could not be read (no guessing)', () => {
		// A real pm@x.y.z beats a fabricated one — if the version query failed we
		// leave the field off entirely so Corepack never sees a made-up pin.
		const nv = computeNodeVersion({ nodeVersion: '22.9.0', pm: 'yarn', pmVersion: null });
		expect(nv.packageManager).toBeUndefined();
	});
});
