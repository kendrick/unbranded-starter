import { describe, expect, it } from 'vitest';
import { nodeVersionError } from './node-version';

describe('nodeVersionError', () => {
	it('flags Node 20.11 as too old and names the floor and current version', () => {
		const message = nodeVersionError('20.11.0', 22);
		expect(message).not.toBeNull();
		expect(message).toContain('22');
		expect(message).toContain('20.11.0');
	});

	it('flags Node 18 as too old', () => {
		const message = nodeVersionError('18.0.0', 22);
		expect(message).not.toBeNull();
		expect(message).toContain('22');
		expect(message).toContain('18.0.0');
	});

	it('accepts the floor itself', () => {
		expect(nodeVersionError('22.0.0', 22)).toBeNull();
	});

	it('accepts a newer major', () => {
		expect(nodeVersionError('24.5.0', 22)).toBeNull();
	});
});
