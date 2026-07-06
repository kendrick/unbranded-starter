import { afterEach, describe, expect, it } from 'vitest';
import { applyColorPolicy, colorEnvPatch, computeColorEnabled } from './color';

describe('computeColorEnabled', () => {
	it('follows the stream when nothing overrides it', () => {
		expect(computeColorEnabled({ env: {}, argv: [], isTTY: true })).toBe(true);
		expect(computeColorEnabled({ env: {}, argv: [], isTTY: false })).toBe(false);
	});

	it('treats a pipe as plain even under CI (unlike picocolors)', () => {
		// The whole point of the audit: a piped run must be script-safe, so we
		// deliberately drop picocolors' CI/win32 forcing.
		expect(computeColorEnabled({ env: { CI: 'true' }, argv: [], isTTY: false })).toBe(false);
	});

	it('lets NO_COLOR and --no-color force color off', () => {
		expect(computeColorEnabled({ env: { NO_COLOR: '1' }, argv: [], isTTY: true })).toBe(false);
		expect(computeColorEnabled({ env: {}, argv: ['--no-color'], isTTY: true })).toBe(false);
	});

	it('lets FORCE_COLOR and --color force color on over a pipe', () => {
		expect(computeColorEnabled({ env: { FORCE_COLOR: '1' }, argv: [], isTTY: false })).toBe(true);
		expect(computeColorEnabled({ env: {}, argv: ['--color'], isTTY: false })).toBe(true);
	});

	it('lets an explicit off beat an explicit on', () => {
		// A user who set both meant to disable; off wins.
		expect(computeColorEnabled({ env: { NO_COLOR: '1' }, argv: ['--color'], isTTY: false })).toBe(false);
		expect(computeColorEnabled({ env: { FORCE_COLOR: '1' }, argv: ['--no-color'], isTTY: true })).toBe(false);
	});

	it('treats an empty NO_COLOR as unset, matching picocolors', () => {
		expect(computeColorEnabled({ env: { NO_COLOR: '' }, argv: [], isTTY: true })).toBe(true);
	});
});

describe('applyColorPolicy', () => {
	const priorNoColor = process.env.NO_COLOR;
	const priorForceColor = process.env.FORCE_COLOR;

	afterEach(() => {
		restore('NO_COLOR', priorNoColor);
		restore('FORCE_COLOR', priorForceColor);
	});

	function restore(key: string, value: string | undefined): void {
		if (value === undefined)
			delete process.env[key];
		else
			process.env[key] = value;
	}

	it('sets NO_COLOR when the policy resolves to off, so clack sees it too', () => {
		// The unit suite runs piped (isTTY undefined), so the default policy is off.
		delete process.env.NO_COLOR;
		delete process.env.FORCE_COLOR;
		applyColorPolicy();
		expect(process.env.NO_COLOR).toBe('1');
	});

	it('leaves color alone when the policy resolves to on', () => {
		delete process.env.NO_COLOR;
		process.env.FORCE_COLOR = '1';
		applyColorPolicy();
		expect(process.env.NO_COLOR).toBeUndefined();
	});
});

describe('colorEnvPatch', () => {
	it('sets NO_COLOR when color is off, so styleText (clack, the picker) sees it', () => {
		expect(colorEnvPatch({ env: {}, argv: ['--no-color'], isTTY: true })).toEqual({ NO_COLOR: '1' });
		expect(colorEnvPatch({ env: {}, argv: [], isTTY: false })).toEqual({ NO_COLOR: '1' });
	});

	it('clears a conflicting FORCE_COLOR when --no-color wins, so styleText can honor NO_COLOR', () => {
		// node lets FORCE_COLOR override (and warn over) NO_COLOR, so an explicit off
		// has to drop it rather than merely add NO_COLOR beside it.
		expect(colorEnvPatch({ env: { FORCE_COLOR: '1' }, argv: ['--no-color'], isTTY: true })).toEqual({ FORCE_COLOR: null, NO_COLOR: '1' });
	});

	it('does nothing when a real TTY or an existing FORCE_COLOR already colors', () => {
		expect(colorEnvPatch({ env: {}, argv: [], isTTY: true })).toEqual({});
		expect(colorEnvPatch({ env: { FORCE_COLOR: '1' }, argv: [], isTTY: false })).toEqual({});
	});

	it('forces color for --color over a pipe, the one case styleText can\'t infer from argv', () => {
		expect(colorEnvPatch({ env: {}, argv: ['--color'], isTTY: false })).toEqual({ FORCE_COLOR: '1' });
	});

	it('does not leave NO_COLOR set when it is already absent and color is on', () => {
		expect(colorEnvPatch({ env: {}, argv: ['--color'], isTTY: true })).toEqual({});
	});
});
