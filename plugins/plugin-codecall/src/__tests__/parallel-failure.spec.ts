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

  it('finds a failure only by its whole message, not one that starts or ends another listed one', () => {
    const listed = parallelFailuresOf(
      '2 of 3 parallel operations failed:\nReview denied the call to orders.void: not allowed\n[2]: Locked: try later',
    );

    expect(listed?.('Review denied the call to orders.void: no')).toBe(false);
    expect(listed?.('Review denied the call to orders.void: not allowed here')).toBe(false);
    expect(listed?.('try later')).toBe(false);
    expect(listed?.('Review denied the call to orders.void: not allowed')).toBe(true);
    expect(listed?.('Locked: try later')).toBe(true);
  });

  it('does not find a message the sandbox cut at its size limit, which it leaves unmarked', () => {
    const failure = 'Invalid tool input: the order id must start with o and hold 8 digits';
    const cut = parallelFailuresOf(
      `3 of 3 parallel operations failed:\nfirst\n${failure.slice(0, 40)}\n(1 more not shown)`,
    );

    expect(cut?.(failure)).toBe(false);
    expect(cut?.('first')).toBe(true);
  });
});
