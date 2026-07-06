import { describe, expect, it } from 'vitest';
import { computeUpdate, merge3 } from './merge3';

const BASE = 'alpha\nbravo\ncharlie\ndelta\n';

describe('merge3', () => {
	it('merges non-overlapping edits from both sides', () => {
		const r = merge3({
			base: BASE,
			mine: 'alpha MINE\nbravo\ncharlie\ndelta\n',
			theirs: 'alpha\nbravo\ncharlie\ndelta THEIRS\n',
		});
		expect(r.result).toBe('clean');
		expect(r.merged).toBe('alpha MINE\nbravo\ncharlie\ndelta THEIRS\n');
	});

	it('treats both sides making the same change as no conflict', () => {
		// A "false conflict": the user hand-applied the same edit the template
		// shipped. There is nothing to argue about.
		const same = 'alpha\nbravo EDITED\ncharlie\ndelta\n';
		const r = merge3({ base: BASE, mine: same, theirs: same });
		expect(r.result).toBe('clean');
		expect(r.merged).toBe(same);
	});

	it('renders git-style markers labeled yours/template on overlap', () => {
		const r = merge3({
			base: BASE,
			mine: 'alpha\nbravo MINE\ncharlie\ndelta\n',
			theirs: 'alpha\nbravo THEIRS\ncharlie\ndelta\n',
		});
		expect(r.result).toBe('conflict');
		if (r.result !== 'conflict')
			return;
		expect(r.conflicts).toBe(1);
		expect(r.merged).toBe('alpha\n<<<<<<< yours\nbravo MINE\n=======\nbravo THEIRS\n>>>>>>> template\ncharlie\ndelta\n');
	});

	it('preserves CRLF endings and a missing trailing newline through a merge', () => {
		const r = merge3({
			base: 'one\r\ntwo\r\nthree',
			mine: 'one EDIT\r\ntwo\r\nthree',
			theirs: 'one\r\ntwo\r\nthree THEIRS',
		});
		expect(r.result).toBe('clean');
		expect(r.merged).toBe('one EDIT\r\ntwo\r\nthree THEIRS');
	});
});

describe('computeUpdate', () => {
	it('is up-to-date when the template did not change, whatever the user did', () => {
		const r = computeUpdate({ base: BASE, mine: 'anything else entirely\n', theirs: BASE });
		expect(r.status).toBe('up-to-date');
		// Nothing to write: the user's file is already the right answer.
		expect(r.merged).toBe('anything else entirely\n');
	});

	it('is up-to-date when the user already matches the new template', () => {
		const next = 'alpha v2\n';
		const r = computeUpdate({ base: BASE, mine: next, theirs: next });
		expect(r.status).toBe('up-to-date');
		expect(r.merged).toBe(next);
	});

	it('is a clean-update when the user never touched the file', () => {
		const next = 'alpha v2\n';
		const r = computeUpdate({ base: BASE, mine: BASE, theirs: next });
		expect(r.status).toBe('clean-update');
		expect(r.merged).toBe(next);
	});

	it('is merged when both sides changed without overlapping', () => {
		const r = computeUpdate({
			base: BASE,
			mine: 'alpha MINE\nbravo\ncharlie\ndelta\n',
			theirs: 'alpha\nbravo\ncharlie\ndelta THEIRS\n',
		});
		expect(r.status).toBe('merged');
		expect(r.merged).toBe('alpha MINE\nbravo\ncharlie\ndelta THEIRS\n');
	});

	it('is a conflict when edits overlap, carrying the marker text for the write-markers strategy', () => {
		const r = computeUpdate({
			base: BASE,
			mine: 'alpha\nbravo MINE\ncharlie\ndelta\n',
			theirs: 'alpha\nbravo THEIRS\ncharlie\ndelta\n',
		});
		expect(r.status).toBe('conflict');
		expect(r.merged).toContain('<<<<<<< yours');
		expect(r.merged).toContain('>>>>>>> template');
	});
});
