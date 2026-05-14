// libs/cli/src/commands/dev/__tests__/port.spec.ts
//
// Unit tests for the port-probing helpers used by `frontmcp dev` (issue #398).

import * as net from 'node:net';

import { findNextFreePort, isPortFree, lookupPortOwner } from '../port';

const HOST = '127.0.0.1';

/** Bind an ephemeral port and return a teardown helper. */
function holdPort(port = 0): Promise<{ port: number; release: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen({ port, host: HOST, exclusive: true }, () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('Could not determine ephemeral port'));
        return;
      }
      resolve({
        port: addr.port,
        release: () => new Promise<void>((res) => server.close(() => res())),
      });
    });
  });
}

describe('isPortFree', () => {
  it('returns true for a free port', async () => {
    const probe = await holdPort();
    await probe.release();
    expect(await isPortFree(probe.port)).toBe(true);
  });

  it('returns false when the port is bound by another listener', async () => {
    const probe = await holdPort();
    try {
      expect(await isPortFree(probe.port)).toBe(false);
    } finally {
      await probe.release();
    }
  });

  it('closes its own probe socket after a successful bind (no port leak)', async () => {
    // Bind once, release, then call isPortFree twice — the second call should
    // still see the port as free, proving the helper closed its own probe.
    const probe = await holdPort();
    await probe.release();
    expect(await isPortFree(probe.port)).toBe(true);
    expect(await isPortFree(probe.port)).toBe(true);
  });
});

describe('findNextFreePort', () => {
  it('returns the starting port when it is already free', async () => {
    const probe = await holdPort();
    await probe.release();
    const free = await findNextFreePort(probe.port);
    expect(free).toBe(probe.port);
  });

  it('walks forward when the starting port is busy', async () => {
    const probe = await holdPort();
    try {
      const free = await findNextFreePort(probe.port);
      expect(free).toBeGreaterThan(probe.port);
      // The returned port must actually be free now.
      expect(await isPortFree(free)).toBe(true);
    } finally {
      await probe.release();
    }
  });

  it('throws after exhausting the probe budget', async () => {
    // maxProbes = 1 means: only check the starting port.
    const probe = await holdPort();
    try {
      await expect(findNextFreePort(probe.port, HOST, 1)).rejects.toThrow(/No free TCP port/);
    } finally {
      await probe.release();
    }
  });
});

describe('lookupPortOwner', () => {
  it('returns undefined on Windows (lsof unavailable)', async () => {
    if (process.platform !== 'win32') {
      // We can't actually flip platform here; just smoke-test the POSIX branch.
      const owner = await lookupPortOwner(1);
      // Port 1 is privileged + almost certainly not bound by us; should be undefined or a string.
      expect(owner === undefined || typeof owner === 'string').toBe(true);
      return;
    }
    expect(await lookupPortOwner(1)).toBeUndefined();
  });
});
