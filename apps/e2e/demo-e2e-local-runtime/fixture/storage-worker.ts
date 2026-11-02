/** On "go": increment, take an NX lock and a semaphore slot, and report the errors and longest timer gap seen. */
import { DistributedSemaphore } from '@frontmcp/guard';
import { createStorage } from '@frontmcp/utils';

import { readyThenWaitForGo, report, requiredEnv, runWorker } from './worker-protocol';

export interface StorageWorkerResult {
  incrValues: number[];
  errors: string[];
  holdsNxLock: boolean;
  acquiredSlot: boolean;
  maxTimerGapMs: number;
}

const TIMER_INTERVAL_MS = 5;

function watchTimerGaps(): { stop(): number } {
  let last = performance.now();
  let maxGap = 0;
  const tick = () => {
    const now = performance.now();
    maxGap = Math.max(maxGap, now - last);
    last = now;
  };
  const timer = setInterval(tick, TIMER_INTERVAL_MS);
  return {
    stop() {
      clearInterval(timer);
      tick();
      return Math.round(maxGap);
    },
  };
}

function describeError(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return `${typeof code === 'string' ? `${code}: ` : ''}${error instanceof Error ? error.message : String(error)}`;
}

runWorker(async () => {
  const workerId = requiredEnv('WORKER_ID');
  const increments = Number(requiredEnv('INCREMENTS'));
  const storage = await createStorage({
    type: 'sqlite',
    fallback: 'error',
    sqlite: { path: requiredEnv('DB_PATH'), walMode: requiredEnv('WAL_MODE') === 'true', ttlCleanupIntervalMs: 200 },
  });
  const semaphore = new DistributedSemaphore(storage, 60);
  await readyThenWaitForGo();

  const timerGaps = watchTimerGaps();
  const errors: string[] = [];
  const incrValues: number[] = [];
  let holdsNxLock = false;
  let acquiredSlot = false;
  try {
    for (let i = 0; i < increments; i++) incrValues.push(await storage.incr('total'));
    await storage.set('nx-lock', workerId, { ifNotExists: true, ttlSeconds: 60 });
    holdsNxLock = (await storage.get('nx-lock')) === workerId;
    acquiredSlot = (await semaphore.acquire('job', 1, 0, 'job')) !== null;
  } catch (error) {
    errors.push(describeError(error));
  }
  const maxTimerGapMs = timerGaps.stop();

  await storage.disconnect();
  report({ incrValues, errors, holdsNxLock, acquiredSlot, maxTimerGapMs } satisfies StorageWorkerResult);
});
