/** Start one child owned under `MARKER` and one unmarked child, both detached, report their pids, and exit: both outlive their owner. */
import { getSpawnFn, spawnOwned } from '@frontmcp/utils';

import { report, requiredEnv, runWorker } from './worker-protocol';

export interface OrphanOwnerResult {
  marked: number;
  unmarked: number;
}

// `--` ends node's own options, so the owner tag spawnOwned appends reaches the script as an argument.
const IDLE = ['-e', 'setInterval(() => {}, 1000)', '--'];

runWorker(async () => {
  const marked = spawnOwned(process.execPath, IDLE, {
    marker: requiredEnv('MARKER'),
    detached: true,
    stdio: 'ignore',
  }).child;
  const unmarked = getSpawnFn()(process.execPath, IDLE, { detached: true, stdio: 'ignore' });
  marked.unref();
  unmarked.unref();
  if (marked.pid === undefined || unmarked.pid === undefined) throw new Error('worker: a child has no pid');
  report({ marked: marked.pid, unmarked: unmarked.pid } satisfies OrphanOwnerResult);
});
