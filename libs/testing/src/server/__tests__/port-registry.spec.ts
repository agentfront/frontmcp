import { createServer } from 'net';

import { getPortRange, releaseAllPorts, reservePort } from '../port-registry';

function canListen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.listen(port, () => server.close(() => resolve(true)));
  });
}

describe('port-registry', () => {
  afterEach(async () => {
    await releaseAllPorts();
  });

  it('treats port 0 as "any free port" from the project range', async () => {
    const range = getPortRange('default');
    const { port, release } = await reservePort('default', 0);
    expect(port).toBeGreaterThan(0);
    expect(port).toBeGreaterThanOrEqual(range.start);
    await release();
  });

  it('never hands out the same port twice while a reservation is held', async () => {
    const a = await reservePort('default');
    const b = await reservePort('default');
    expect(a.port).not.toBe(b.port);
    await a.release();
    await b.release();
  });

  it('keeps the port reserved after releaseSocket and frees it on release', async () => {
    const { port, release, releaseSocket } = await reservePort('default');

    await releaseSocket();
    // The socket is free for the server to bind, but the port is still claimed
    expect(await canListen(port)).toBe(true);
    const other = await reservePort('default');
    expect(other.port).not.toBe(port);
    await other.release();

    await release();
    const again = await reservePort('default', port);
    expect(again.port).toBe(port);
    await again.release();
  });

  it('falls back to the range when the preferred port is taken', async () => {
    const first = await reservePort('default');
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const second = await reservePort('default', first.port);
    expect(second.port).not.toBe(first.port);
    warn.mockRestore();
    await first.release();
    await second.release();
  });

  it('skips a port locked by another live process', async () => {
    const fs = require('node:fs');
    const os = require('node:os');
    const path = require('node:path');
    const dir = path.join(os.tmpdir(), 'frontmcp-testing-ports');
    fs.mkdirSync(dir, { recursive: true });
    const range = getPortRange('mock-api');
    const lock = path.join(dir, `${range.start}.lock`);
    // Parent pid is a live process that is not us
    fs.writeFileSync(lock, JSON.stringify({ pid: process.ppid, at: Date.now() }));
    try {
      const { port, release } = await reservePort('mock-api');
      expect(port).not.toBe(range.start);
      await release();
    } finally {
      fs.unlinkSync(lock);
    }
  });

  it('takes over a lock left by a dead process', async () => {
    const fs = require('node:fs');
    const os = require('node:os');
    const path = require('node:path');
    const dir = path.join(os.tmpdir(), 'frontmcp-testing-ports');
    fs.mkdirSync(dir, { recursive: true });
    const range = getPortRange('mock-cimd');
    const lock = path.join(dir, `${range.start}.lock`);
    fs.writeFileSync(lock, JSON.stringify({ pid: 2 ** 22 + 12345, at: Date.now() }));
    const { port, release } = await reservePort('mock-cimd');
    expect(port).toBe(range.start);
    await release();
    expect(fs.existsSync(lock)).toBe(false);
  });
});
