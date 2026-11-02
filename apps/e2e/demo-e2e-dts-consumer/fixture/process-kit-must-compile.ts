import 'reflect-metadata';

import { App, FrontMcp, TASK_WORKER_MARKER } from '@frontmcp/sdk';
import {
  OwnedProcessError,
  reapOrphans,
  spawnOwned,
  watchParent,
  watchPath,
  type OwnedProcess,
  type ParentGoneReason,
  type ProcessWatcher,
} from '@frontmcp/utils';

@App({ name: 'attached' })
class AttachedApp {}

@FrontMcp({
  info: { name: 'attached', version: '1.0.0' },
  apps: [AttachedApp],
  lifecycle: { exitWhenOrphaned: false },
})
export class AttachedServer {}

@FrontMcp({
  info: { name: 'attached-typo', version: '1.0.0' },
  apps: [AttachedApp],
  // @ts-expect-error exitWhenOrphaned is a boolean
  lifecycle: { exitWhenOrphaned: 'no' },
})
export class AttachedTypoServer {}

export function startWorker(): OwnedProcess {
  return spawnOwned(process.execPath, ['worker.js'], { marker: 'worker', detached: true, stdio: 'ignore' });
}

// @ts-expect-error the marker is required
spawnOwned(process.execPath, ['worker.js'], { detached: true });

export async function reapTaskWorkers(): Promise<number[]> {
  try {
    return await reapOrphans(TASK_WORKER_MARKER, { graceMs: 1000 });
  } catch (error) {
    if (error instanceof OwnedProcessError) return [];
    throw error;
  }
}

export function exitWithParent(onGone: (reason: ParentGoneReason) => void): ProcessWatcher[] {
  return [
    watchParent({ onGone, stdin: process.stdin }),
    watchPath('/srv/checkout', { onGone: () => onGone('parent-exited') }),
  ];
}
