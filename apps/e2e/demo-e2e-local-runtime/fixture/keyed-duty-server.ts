/**
 * A server whose duty names its lease with the key `LEASE_KEY` and prefers to run when `PREFER` is 1 (#1358). It
 * prints `ran <pid> <ms>` on each run, every `EVERY_MS`; SIGTERM shuts it down gracefully.
 */
import 'reflect-metadata';

import { App, Duty, FrontMcpInstance, LogLevel } from '@frontmcp/sdk';

import { report, requiredEnv, runWorker, signal } from './worker-protocol';

@Duty({
  name: 'keep-file',
  every: Number(requiredEnv('EVERY_MS')),
  scope: { key: () => requiredEnv('LEASE_KEY') },
  prefer: () => process.env['PREFER'] === '1',
  leaseMs: Number(requiredEnv('LEASE_MS')),
})
class KeepFileDuty {
  run(): void {
    signal(`ran ${process.pid} ${Date.now()}`);
  }
}

@App({ name: 'keeper', providers: [KeepFileDuty] })
class KeeperApp {}

runWorker(async () => {
  const server = await FrontMcpInstance.createDirect({
    info: { name: 'keyed-duty-e2e', version: '1.0.0' },
    apps: [KeeperApp],
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
