import { describe, expect, it, vi } from 'vitest';
import { CANCEL_EXIT, cancelAndExit } from './cancel';

describe('cancelAndExit', () => {
	it('exits with the SIGINT convention code (128 + 2)', () => {
		expect(CANCEL_EXIT).toBe(130);
		const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

		cancelAndExit('Cancelled.');

		expect(exit).toHaveBeenCalledWith(130);
		exit.mockRestore();
	});
});
