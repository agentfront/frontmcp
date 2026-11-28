/**
 * E2E: a server starts on an existing container (#1356). An HTTP server from `FrontMcpInstance.bootstrap()` and a
 * direct server, in one process, on one `createContainer()`: the container's providers are built once, both hosts use
 * the same instances, the container's duty runs once a server serves, and only `dispose()` shuts the providers down.
 */
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';

import type { ContainerHostsResult } from '../fixture/container-hosts';
import { killAll, spawnWorker, type Worker } from './helpers/workers';

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as net.AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

describe('a server on an existing container', () => {
  let home: string;
  let started: Worker<unknown>[] = [];

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'local-runtime-container-'));
  });

  afterEach(() => {
    killAll(started);
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('builds each provider once for an HTTP server and a direct server, and shuts them down with the container', async () => {
    const worker = spawnWorker<ContainerHostsResult>('container-hosts.ts', {
      FRONTMCP_HOME: home,
      PORT: String(await freePort()),
    });
    started = [worker];

    const result = await worker.result;

    expect(result).toEqual({
      built: 1,
      viaHttp: { count: 1, pid: worker.child.pid },
      viaDirect: { count: 2, pid: worker.child.pid },
      dutyRan: true,
      shutdownsBeforeDispose: 0,
      shutdowns: 1,
    });
  }, 120_000);
});
