/** A server with one machine duty that prints `ran <pid> <ms>` on each run; SIGTERM shuts it down gracefully. */
import 'reflect-metadata';

import { App, Duty, FrontMcpInstance, LogLevel } from '@frontmcp/sdk';

import { report, requiredEnv, runWorker, signal } from './worker-protocol';

@Duty({
  name: 'tick',
  every: Number(requiredEnv('EVERY_MS')),
  scope: 'machine',
  leaseMs: Number(requiredEnv('LEASE_MS')),
})
class TickDuty {
  run(): void {
    signal(`ran ${process.pid} ${Date.now()}`);
  }
}

@App({ name: 'duties', providers: [TickDuty] })
class DutiesApp {}

runWorker(async () => {
  const server = await FrontMcpInstance.createDirect({
    info: { name: 'duty-e2e', version: '1.0.0' },
    apps: [DutiesApp],
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
