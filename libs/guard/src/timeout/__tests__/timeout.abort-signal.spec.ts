import { ExecutionTimeoutError } from '../../errors/index';
import { withTimeout } from '../index';

type SignalAwareWork = (signal?: AbortSignal) => Promise<string>;

describe('withTimeout abort signal', () => {
  it('passes an AbortSignal to the wrapped function', async () => {
    let receivedSignal: AbortSignal | undefined;
    const work: SignalAwareWork = async (signal) => {
      receivedSignal = signal;
      return 'done';
    };

    await withTimeout(work, 1000, 'signal-tool');

    expect(receivedSignal).toBeInstanceOf(AbortSignal);
  });

  it('aborts the signal given to the wrapped function when the deadline passes', async () => {
    let receivedSignal: AbortSignal | undefined;
    const work: SignalAwareWork = (signal) => {
      receivedSignal = signal;
      return new Promise<string>((resolve) => setTimeout(() => resolve('late'), 300));
    };

    await expect(withTimeout(work, 50, 'slow-tool')).rejects.toThrow(ExecutionTimeoutError);

    expect(receivedSignal?.aborted).toBe(true);
  });
});
