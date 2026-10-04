/// <reference types="jest" />

/**
 * Starts every test of the enclosing `describe` in the middle of a rate-limit window.
 *
 * The guard's sliding-window limiter aligns its windows to the wall clock. A test whose calls cross a
 * window boundary sees the previous window's count weighted just below the limit, so the next call is
 * let through and the test fails at random. The clock still advances; it is only shifted.
 */
export function useMidRateLimitWindow(windowMs: number): void {
  let clock: jest.SpyInstance<number, []> | undefined;

  beforeEach(() => {
    const realNow = Date.now.bind(Date);
    const startOfWindow = Math.floor(realNow() / windowMs) * windowMs;
    const clockOffset = startOfWindow + windowMs / 2 - realNow();
    clock = jest.spyOn(Date, 'now').mockImplementation(() => realNow() + clockOffset);
  });

  afterEach(() => {
    clock?.mockRestore();
  });
}
