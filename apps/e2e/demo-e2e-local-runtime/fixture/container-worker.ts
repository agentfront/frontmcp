/**
 * A script that reads the SQLite storage the SDK provides (`sqliteStorageProvider`, `SqliteStorageToken`)
 * from `createContainer()`: on "go" it increments a counter shared with the other workers, then disposes
 * the container and reports the values it got.
 */
import 'reflect-metadata';

import { createContainer, LogLevel, sqliteStorageProvider, SqliteStorageToken } from '@frontmcp/sdk';

import { readyThenWaitForGo, report, requiredEnv, runWorker } from './worker-protocol';

export interface ContainerWorkerResult {
  incrValues: number[];
}

runWorker(async () => {
  const container = await createContainer({
    providers: [sqliteStorageProvider({ path: requiredEnv('DB_PATH'), prefix: 'app:' })],
    logging: { level: LogLevel.Off, enableConsole: false },
  });
  const storage = container.get(SqliteStorageToken);
  await readyThenWaitForGo();

  const incrValues: number[] = [];
  for (let i = 0; i < Number(requiredEnv('INCREMENTS')); i++) incrValues.push(await storage.incr('total'));

  await container.dispose();
  report({ incrValues } satisfies ContainerWorkerResult);
});
