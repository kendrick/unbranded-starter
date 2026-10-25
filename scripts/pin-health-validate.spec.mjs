import { describe, expect, it } from 'vitest';
import { GATE, parseRepro, reproCommand } from './pin-health-validate.mjs';

describe('parseRepro', () => {
	it('accepts one e2e spec with UB_* selectors', () => {
		expect(
			parseRepro('{"spec":"test/e2e/preset-install.spec.ts","env":{"UB_PRESET":"next-app"}}'),
		).toEqual({
			spec: 'test/e2e/preset-install.spec.ts',
			env: { UB_PRESET: 'next-app' },
		});
	});

	it('defaults env to empty', () => {
		expect(parseRepro('{"spec":"test/e2e/scaffold-lint.spec.ts"}').env).toEqual({});
	});

	it.each([
		['{"spec":"test/e2e/../../scripts/x.spec.ts"}'],
		['{"spec":"src/commands/doctor.spec.ts"}'],
		['{"spec":"test/e2e/a.spec.ts; rm -rf /"}'],
		['{"spec":"test/e2e/a.spec.ts","env":{"PATH":"/tmp"}}'],
		['{"spec":"test/e2e/a.spec.ts","env":{"UB_FLAVOR":"react; echo"}}'],
		['{"spec":"test/e2e/a.spec.ts","env":{"UB_FLAVOR":1}}'],
	])('rejects %s', (raw) => {
		expect(() => parseRepro(raw)).toThrow();
	});
});

describe('reproCommand', () => {
	it('runs the spec through the e2e vitest config with its env', () => {
		expect(
			reproCommand({ spec: 'test/e2e/eslint-flavors.spec.ts', env: { UB_FLAVOR: 'react' } }),
		).toEqual([
			'pnpm',
			['vitest', 'run', '--config', 'vitest.e2e.config.ts', 'test/e2e/eslint-flavors.spec.ts'],
			{ UB_FLAVOR: 'react' },
		]);
	});
});

describe('the validation gate', () => {
	// ci.yml's `checks` job is the contract this mirrors; lint runs with CI=true for parity, per AGENTS.md.
	it('installs from the lockfile, then mirrors the checks job order and lints in CI mode', () => {
		expect(GATE.map(([, args]) => args.join(' '))).toEqual([
			'install --frozen-lockfile',
			'typecheck',
			'lint',
			'test',
			'build',
		]);
		expect(GATE[2][2]).toEqual({ CI: 'true' });
	});
});
