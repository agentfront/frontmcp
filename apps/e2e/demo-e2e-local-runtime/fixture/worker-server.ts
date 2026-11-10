/**
 * A server with one machine worker that prints `running <pid> <ms>` when its run starts and `ended <pid>` when its
 * signal aborts. `FAIL_FIRST_RUNS` makes its first runs throw. SIGTERM shuts the server down gracefully.
 */
import 'reflect-metadata';

import { App, FrontMcpInstance, LogLevel, Worker, type WorkerRunContext } from '@frontmcp/sdk';

import { report, requiredEnv, runWorker, signal } from './worker-protocol';

let runsToFail = Number(process.env['FAIL_FIRST_RUNS'] ?? '0');

@Worker({
  name: 'watcher',
  scope: 'machine',
  leaseMs: Number(requiredEnv('LEASE_MS')),
  restart: { minDelayMs: 50, maxDelayMs: 200 },
})
class WatcherWorker {
  async run({ signal: aborted }: WorkerRunContext): Promise<void> {
    if (runsToFail > 0) {
      runsToFail--;
      signal(`failed ${process.pid}`);
      throw new Error('upstream refused the connection');
    }
    signal(`running ${process.pid} ${Date.now()}`);
    await new Promise<void>((resolve) => aborted.addEventListener('abort', () => resolve()));
    signal(`ended ${process.pid}`);
  }
}

@App({ name: 'workers', providers: [WatcherWorker] })
class WorkersApp {}

runWorker(async () => {
  const server = await FrontMcpInstance.createDirect({
    info: { name: 'worker-e2e', version: '1.0.0' },
    apps: [WorkersApp],
    logging: { level: LogLevel.Off, enableConsole: false },
  });
  const keepAlive = setInterval(() => undefined, 60_000);
  const terminated = new Promise<void>((resolve) => process.once('SIGTERM', () => resolve()));
  signal('ready');

  await terminated;
  await server.dispose();
  clearInterval(keepAlive);
  report({ stopped: true });
});
