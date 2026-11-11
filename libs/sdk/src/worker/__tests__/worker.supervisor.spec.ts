import type { ResolvedWorkerRestart, WorkerRunContext } from '../../common';
import { WorkerSupervisor, type WorkerLogger } from '../worker.supervisor';

const START = 1_700_000_000_000;
const DEFAULT_RESTART: ResolvedWorkerRestart = { minDelayMs: 1_000, maxDelayMs: 60_000, factor: 2 };

interface Probe {
  supervisor: WorkerSupervisor;
  starts: number[];
  logger: jest.Mocked<WorkerLogger>;
}

function elapsed(): number {
  return Date.now() - START;
}

function probe(
  run: (context: WorkerRunContext, attempt: number) => unknown,
  restart: false | ResolvedWorkerRestart = DEFAULT_RESTART,
): Probe {
  const starts: number[] = [];
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const supervisor = new WorkerSupervisor({
    name: 'inbox',
    restart,
    logger,
    run: (context) => {
      starts.push(elapsed());
      return run(context, starts.length);
    },
  });
  return { supervisor, starts, logger };
}

function untilAborted({ signal }: WorkerRunContext): Promise<void> {
  return new Promise((resolve) => signal.addEventListener('abort', () => resolve()));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fail(message: string): Promise<never> {
  return Promise.reject(new Error(message));
}

describe('WorkerSupervisor', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: START });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('is on standby until it is started, then runs the worker with a signal that is not aborted', async () => {
    let received: AbortSignal | undefined;
    const worker = probe((context) => {
      received = context.signal;
      return untilAborted(context);
    });
    expect(worker.supervisor.status()).toEqual({ state: 'standby', restarts: 0 });

    worker.supervisor.start();
    await jest.advanceTimersByTimeAsync(10_000);

    expect(worker.starts).toEqual([0]);
    expect(received?.aborted).toBe(false);
    expect(worker.supervisor.status()).toEqual({ state: 'running', restarts: 0 });
    await worker.supervisor.stop();
  });

  it('runs a worker that throws again after waits that double from minDelayMs up to maxDelayMs', async () => {
    const worker = probe(() => fail('connection refused'), { minDelayMs: 1_000, maxDelayMs: 5_000, factor: 2 });

    worker.supervisor.start();
    await jest.advanceTimersByTimeAsync(20_000);

    expect(worker.starts).toEqual([0, 1_000, 3_000, 7_000, 12_000, 17_000]);
    expect(worker.supervisor.status()).toEqual({
      state: 'restarting',
      restarts: 6,
      lastError: 'connection refused',
    });
    expect(worker.logger.error.mock.calls.slice(0, 4)).toEqual([
      ['Worker "inbox" failed: connection refused; it runs again in 1000 ms'],
      ['Worker "inbox" failed: connection refused; it runs again in 2000 ms'],
      ['Worker "inbox" failed: connection refused; it runs again in 4000 ms'],
      ['Worker "inbox" failed: connection refused; it runs again in 5000 ms'],
    ]);
    await worker.supervisor.stop();
  });

  it('runs a worker that returns before its signal aborts again, and says so', async () => {
    const worker = probe(() => undefined);

    worker.supervisor.start();
    await jest.advanceTimersByTimeAsync(3_500);

    expect(worker.starts).toEqual([0, 1_000, 3_000]);
    expect(worker.supervisor.status()).toEqual({ state: 'restarting', restarts: 3 });
    expect(worker.logger.warn).toHaveBeenCalledWith(
      'Worker "inbox" returned before its signal was aborted; it runs again in 1000 ms',
    );
    expect(worker.logger.error).not.toHaveBeenCalled();
    await worker.supervisor.stop();
  });

  it('logs a worker that throws synchronously, or throws something that is not an Error', async () => {
    const worker = probe((_context, attempt) => {
      if (attempt === 1) throw new Error('bad config');
      return Promise.reject('socket closed');
    });

    worker.supervisor.start();
    await jest.advanceTimersByTimeAsync(1_000);

    expect(worker.logger.error.mock.calls).toEqual([
      ['Worker "inbox" failed: bad config; it runs again in 1000 ms'],
      ['Worker "inbox" failed: socket closed; it runs again in 2000 ms'],
    ]);
    await worker.supervisor.stop();
  });

  it('keeps supervising a worker that throws a value with no string form', async () => {
    const worker = probe(() => {
      throw Object.create(null);
    });

    worker.supervisor.start();
    await jest.advanceTimersByTimeAsync(1_000);

    expect(worker.starts).toEqual([0, 1_000]);
    expect(worker.supervisor.status()).toEqual({ state: 'restarting', restarts: 2, lastError: '[object Object]' });
    expect(worker.logger.error).toHaveBeenCalledWith(
      'Worker "inbox" failed: [object Object]; it runs again in 1000 ms',
    );
    await worker.supervisor.stop();
  });

  it('logs a failure of the supervision itself, and still stops', async () => {
    const worker = probe(() => undefined, false);
    worker.logger.warn.mockImplementationOnce(() => {
      throw new Error('the log sink is closed');
    });

    worker.supervisor.start();
    await jest.advanceTimersByTimeAsync(0);

    await expect(worker.supervisor.stop()).resolves.toBeUndefined();
    expect(worker.logger.error).toHaveBeenCalledWith('Worker "inbox" is no longer supervised: the log sink is closed');
  });

  it('starts the waits over after a run that lasted longer than maxDelayMs', async () => {
    const worker = probe(
      async (_context, attempt) => {
        if (attempt === 3) await delay(5_001);
        throw new Error('dropped');
      },
      { minDelayMs: 1_000, maxDelayMs: 5_000, factor: 2 },
    );

    worker.supervisor.start();
    await jest.advanceTimersByTimeAsync(12_000);

    expect(worker.starts).toEqual([0, 1_000, 3_000, 9_001, 11_001]);
  });

  it('keeps growing the waits after a run that lasted exactly maxDelayMs', async () => {
    const worker = probe(
      async (_context, attempt) => {
        if (attempt === 3) await delay(5_000);
        throw new Error('dropped');
      },
      { minDelayMs: 1_000, maxDelayMs: 5_000, factor: 2 },
    );

    worker.supervisor.start();
    await jest.advanceTimersByTimeAsync(13_000);

    expect(worker.starts).toEqual([0, 1_000, 3_000, 12_000]);
    await worker.supervisor.stop();
  });

  it('runs once with restart: false, and stays stopped after a failure', async () => {
    const worker = probe(() => fail('no such mailbox'), false);

    worker.supervisor.start();
    await jest.advanceTimersByTimeAsync(120_000);

    expect(worker.starts).toEqual([0]);
    expect(worker.supervisor.status()).toEqual({ state: 'stopped', restarts: 0, lastError: 'no such mailbox' });
    expect(worker.logger.error.mock.calls).toEqual([
      ['Worker "inbox" failed: no such mailbox; it does not run again (restart: false)'],
    ]);
  });

  it('runs once with restart: false, and stays stopped after it returned', async () => {
    const worker = probe(() => undefined, false);

    worker.supervisor.start();
    await jest.advanceTimersByTimeAsync(120_000);

    expect(worker.starts).toEqual([0]);
    expect(worker.supervisor.status()).toEqual({ state: 'stopped', restarts: 0 });
    expect(worker.logger.warn.mock.calls).toEqual([
      ['Worker "inbox" returned before its signal was aborted; it does not run again (restart: false)'],
    ]);
  });

  it('never runs a restart: false worker again once a run ended, and is on standby while aborted', async () => {
    const worker = probe(() => fail('no such mailbox'), false);
    worker.supervisor.start();
    await jest.advanceTimersByTimeAsync(500);

    worker.supervisor.abort();
    expect(worker.supervisor.status()).toEqual({ state: 'standby', restarts: 0, lastError: 'no such mailbox' });

    worker.supervisor.start();
    await jest.advanceTimersByTimeAsync(120_000);

    expect(worker.starts).toEqual([0]);
    expect(worker.supervisor.status()).toEqual({ state: 'stopped', restarts: 0, lastError: 'no such mailbox' });
    expect(worker.logger.error).toHaveBeenCalledTimes(1);
  });

  it('keeps the last error until a run returns', async () => {
    const worker = probe((_context, attempt) => (attempt === 1 ? fail('dropped') : undefined));

    worker.supervisor.start();
    await jest.advanceTimersByTimeAsync(500);
    expect(worker.supervisor.status()).toEqual({ state: 'restarting', restarts: 1, lastError: 'dropped' });

    await jest.advanceTimersByTimeAsync(1_000);
    expect(worker.supervisor.status()).toEqual({ state: 'restarting', restarts: 2 });
    await worker.supervisor.stop();
  });

  it('aborts the signal on stop(), waits for the run to end, and does not run it again', async () => {
    let endedAt: number | undefined;
    const worker = probe(
      ({ signal }) =>
        new Promise<void>((resolve) =>
          signal.addEventListener('abort', () =>
            setTimeout(() => {
              endedAt = elapsed();
              resolve();
            }, 300),
          ),
        ),
    );
    worker.supervisor.start();
    await jest.advanceTimersByTimeAsync(500);

    let stopped = false;
    const stopping = worker.supervisor.stop().then(() => (stopped = true));
    await jest.advanceTimersByTimeAsync(299);
    expect(stopped).toBe(false);

    await jest.advanceTimersByTimeAsync(1);
    await stopping;
    await jest.advanceTimersByTimeAsync(120_000);

    expect(endedAt).toBe(800);
    expect(worker.starts).toEqual([0]);
    expect(worker.supervisor.status()).toEqual({ state: 'standby', restarts: 0 });
    expect(worker.logger.warn).not.toHaveBeenCalled();
  });

  it('does not report what the run throws once its signal is aborted', async () => {
    const worker = probe(
      ({ signal }) =>
        new Promise<void>((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(new Error('aborted while reading'))),
        ),
    );
    worker.supervisor.start();
    await jest.advanceTimersByTimeAsync(500);

    await worker.supervisor.stop();

    expect(worker.supervisor.status()).toEqual({ state: 'standby', restarts: 0 });
    expect(worker.logger.error).not.toHaveBeenCalled();
  });

  it('ends the wait before the next run when it is aborted', async () => {
    const worker = probe(() => fail('dropped'));
    worker.supervisor.start();
    await jest.advanceTimersByTimeAsync(500);
    expect(worker.supervisor.status().state).toBe('restarting');

    await worker.supervisor.stop();
    await jest.advanceTimersByTimeAsync(120_000);

    expect(worker.starts).toEqual([0]);
    expect(worker.supervisor.status().state).toBe('standby');
    expect(jest.getTimerCount()).toBe(0);
  });

  it('starts again after an abort only once the last run has ended, so two never overlap', async () => {
    let running = 0;
    let mostRunning = 0;
    const worker = probe(async ({ signal }) => {
      running++;
      mostRunning = Math.max(mostRunning, running);
      await new Promise<void>((resolve) => signal.addEventListener('abort', () => setTimeout(resolve, 2_000)));
      running--;
    });
    worker.supervisor.start();
    await jest.advanceTimersByTimeAsync(500);

    worker.supervisor.abort();
    worker.supervisor.start();
    await jest.advanceTimersByTimeAsync(1_999);
    expect(worker.starts).toEqual([0]);

    await jest.advanceTimersByTimeAsync(1);
    expect(worker.starts).toEqual([0, 2_500]);
    expect(mostRunning).toBe(1);
    expect(worker.supervisor.status()).toEqual({ state: 'running', restarts: 0 });
    await Promise.all([worker.supervisor.stop(), jest.advanceTimersByTimeAsync(2_000)]);
  });

  it('never starts a run it was told to abort before the last one ended', async () => {
    const worker = probe(
      ({ signal }) =>
        new Promise<void>((resolve) => signal.addEventListener('abort', () => setTimeout(resolve, 1_000))),
    );
    worker.supervisor.start();
    await jest.advanceTimersByTimeAsync(500);

    worker.supervisor.abort();
    worker.supervisor.start();
    worker.supervisor.abort();
    await jest.advanceTimersByTimeAsync(5_000);

    expect(worker.starts).toEqual([0]);
    expect(worker.supervisor.status().state).toBe('standby');
  });

  it('never starts again once stop() was called', async () => {
    const worker = probe(untilAborted);
    worker.supervisor.start();
    await jest.advanceTimersByTimeAsync(500);

    await worker.supervisor.stop();
    worker.supervisor.start();
    await jest.advanceTimersByTimeAsync(10_000);

    expect(worker.starts).toEqual([0]);
    expect(worker.supervisor.status()).toEqual({ state: 'standby', restarts: 0 });
  });

  it('does nothing on stop() before it was started', async () => {
    const worker = probe(untilAborted);

    await worker.supervisor.stop();

    expect(worker.starts).toEqual([]);
    expect(worker.supervisor.status()).toEqual({ state: 'standby', restarts: 0 });
  });
});
