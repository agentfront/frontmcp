import { parallelFailuresOf } from '../utils/parallel-failure';

describe('parallelFailuresOf', () => {
  it('is undefined for an error that is not a failed parallel()', () => {
    expect(parallelFailuresOf(undefined)).toBeUndefined();
    expect(parallelFailuresOf('Invalid tool input')).toBeUndefined();
    expect(parallelFailuresOf('Results: 1 of 2 parallel operations failed:\nx')).toBeUndefined();
  });

  it('finds each failure it lists, on lines of their own or after their index, also over several lines', () => {
    const listed = parallelFailuresOf(
      '2 of 5 parallel operations failed:\nInvalid tool input\nDetails: [1]\n[3]: Review denied the call to orders.void: no',
    );

    expect(listed?.('Invalid tool input\nDetails: [1]')).toBe(true);
    expect(listed?.('Review denied the call to orders.void: no')).toBe(true);
    expect(listed?.('Review denied the call to orders.note: no')).toBe(false);
    expect(listed?.('')).toBe(false);
  });

  it('finds the last failure it lists cut short at the size limit, but not a start too short to tell', () => {
    const failure = 'Invalid tool input: the order id must start with o and hold 8 digits';
    const cut = parallelFailuresOf(`2 of 2 parallel operations failed:\nfirst\n${failure.slice(0, 40)}`);
    const tooShort = parallelFailuresOf(`2 of 2 parallel operations failed:\nfirst\n${failure.slice(0, 10)}`);

    expect(cut?.(failure)).toBe(true);
    expect(tooShort?.(failure)).toBe(false);
  });
});
