/**
 * TestServer.stop() returns only once the server itself is gone: its process has exited and its
 * port refuses connections. A server that drains on SIGTERM (FrontMCP servers do since #712) can
 * outlive the shell it was started through; returning when the shell exits let the next suite's
 * readiness check reach the old server on the reused port.
 */
import { connect } from 'node:net';
import { join } from 'node:path';

import { TestServer } from '@frontmcp/testing';

const serverScript = join(__dirname, 'fixtures', 'slow-shutdown-server.cjs');

function acceptsConnections(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect(port, '127.0.0.1');
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

describe('TestServer.stop()', () => {
  it('waits for a server that outlives its shell to stop listening', async () => {
    const server = await TestServer.start({
      command: `node ${JSON.stringify(serverScript)} & wait`,
      project: 'demo-e2e-testing',
      healthCheckPath: '/',
      env: { LINGER_MS: '1500' },
    });
    const { port } = server.info;
    expect(await acceptsConnections(port)).toBe(true);

    await server.stop();

    expect(await acceptsConnections(port)).toBe(false);
  });
});
