import 'reflect-metadata';

import {
  App,
  createContainer,
  FrontMcp,
  Worker,
  type WorkerInterface,
  type WorkerMetadata,
  type WorkerRestartOptions,
  type WorkerRunContext,
  type WorkerScope,
} from '@frontmcp/sdk';

@Worker({ scope: 'process' })
export class CacheWarmer implements WorkerInterface {
  async run({ signal }: WorkerRunContext): Promise<void> {
    if (signal.aborted) return;
  }
}

const backoff: WorkerRestartOptions = { minDelayMs: 500, maxDelayMs: 30_000, factor: 3 };
const scope: WorkerScope = 'cluster';
const inbox: WorkerMetadata = { name: 'inbox-watcher', scope, restart: backoff, leaseMs: 10_000 };

@Worker(inbox)
export class InboxWatcher {
  run(): void {
    return undefined;
  }
}

@Worker({ scope: 'machine', restart: false })
export class OneShotImport implements WorkerInterface {
  run(): Promise<void> {
    return Promise.resolve();
  }
}

@App({ name: 'mail', providers: [CacheWarmer, InboxWatcher, OneShotImport] })
class MailApp {}

@FrontMcp({ info: { name: 'workers', version: '1.0.0' }, apps: [MailApp] })
export class WorkersServer {}

// @ts-expect-error a worker needs a run() method
@Worker({ scope: 'process' })
export class WorkerWithoutRun {}

export class InvalidWorkers {
  // @ts-expect-error scope is 'process', 'machine', 'workspace' or 'cluster'
  static readonly scope: WorkerMetadata = { scope: 'galaxy' };
  // @ts-expect-error a worker needs a scope
  static readonly noScope: WorkerMetadata = { name: 'inbox' };
  // @ts-expect-error restart is false or the waits
  static readonly restart: WorkerMetadata = { scope: 'process', restart: true };
  // @ts-expect-error the waits are numbers of milliseconds
  static readonly waits: WorkerMetadata = { scope: 'process', restart: { minDelayMs: '1s' } };
}

export async function runWorkersInAScript(): Promise<void> {
  const container = await createContainer({
    apps: [MailApp],
    runBackground: true,
    info: { name: 'workers' },
    redis: { url: 'redis://localhost:6379' },
  });
  await container.dispose();
}
