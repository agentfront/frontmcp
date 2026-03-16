import { withTimeout } from '../index';
import { ExecutionTimeoutError } from '../../errors/index';

describe('withTimeout', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should resolve with the function result when it completes within timeout', async () => {
    const fn = jest.fn().mockResolvedValue('success');
    const promise = withTimeout(fn, 5000, 'test-tool');

    // Advance past any immediate timers
    jest.advanceTimersByTime(0);
    const result = await promise;

    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should reject with ExecutionTimeoutError when timeout expires', async () => {
    // Create a promise that never resolves
    const fn = jest.fn().mockReturnValue(new Promise(() => {}));
    const promise = withTimeout(fn, 1000, 'slow-tool');

    // Advance timer past the timeout
    jest.advanceTimersByTime(1001);

    await expect(promise).rejects.toThrow(ExecutionTimeoutError);
    await expect(promise).rejects.toMatchObject({
      entityName: 'slow-tool',
      timeoutMs: 1000,
    });
  });

  it('should clear the timer when function resolves before timeout', async () => {
    const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');
    const fn = jest.fn().mockResolvedValue('done');

    await withTimeout(fn, 5000, 'fast-tool');

    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
  });

  it('should clear the timer when function rejects before timeout', async () => {
    const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');
    const fn = jest.fn().mockRejectedValue(new Error('oops'));

    await expect(withTimeout(fn, 5000, 'failing-tool')).rejects.toThrow('oops');

    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
  });

  it('should propagate non-timeout errors from the function', async () => {
    const customError = new Error('custom error');
    const fn = jest.fn().mockRejectedValue(customError);

    await expect(withTimeout(fn, 5000, 'error-tool')).rejects.toThrow('custom error');
  });

  it('should include entity name and timeout in error message', async () => {
    const fn = jest.fn().mockReturnValue(new Promise(() => {}));
    const promise = withTimeout(fn, 2500, 'my-search');

    jest.advanceTimersByTime(2501);

    try {
      await promise;
      fail('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ExecutionTimeoutError);
      expect((error as ExecutionTimeoutError).message).toContain('my-search');
      expect((error as ExecutionTimeoutError).message).toContain('2500');
    }
  });
});
