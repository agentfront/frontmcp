/** E2E: several processes share the storage `sqliteStorageProvider()` registers, read from `createContainer()`. */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type { ContainerWorkerResult } from '../fixture/container-worker';
import { killAll, runTogether, spawnWorker, type Worker } from './helpers/workers';

const WORKERS = 3;
const INCREMENTS = 20;

describe('SqliteStorageToken in several processes', () => {
  let dir: string;
  let started: Worker<unknown>[] = [];

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-runtime-provider-'));
  });

  afterEach(() => {
    killAll(started);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('shares one counter between the processes, and each one exits after dispose()', async () => {
    const workers = Array.from({ length: WORKERS }, () =>
      spawnWorker<ContainerWorkerResult>('container-worker.ts', {
        DB_PATH: path.join(dir, 'app.sqlite'),
        INCREMENTS: String(INCREMENTS),
      }),
    );
    started = workers;

    const results = await runTogether(workers);

    const values = results.flatMap((result) => result.incrValues).sort((a, b) => a - b);
    expect(values).toEqual(Array.from({ length: WORKERS * INCREMENTS }, (_, index) => index + 1));
    expect(workers.map(({ child }) => child.exitCode)).toEqual(Array(WORKERS).fill(0));
  });
});
