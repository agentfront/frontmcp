// libs/cli/src/commands/dev/__tests__/resolve-dev-port.spec.ts
//
// Tests for resolveDevPort — the pre-flight probe used by `frontmcp dev`
// to surface EADDRINUSE clearly (issue #398).

import * as net from 'node:net';

import { resolveDevPort } from '../dev';

const HOST = '127.0.0.1';

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

describe('resolveDevPort (issue #398)', () => {
  it('returns the requested port when it is free', async () => {
    const probe = await holdPort();
    await probe.release();
    const logs: string[] = [];
    const port = await resolveDevPort({
      port: probe.port,
      log: (m) => logs.push(m),
      exit: ((c: number) => {
        throw new Error(`should not exit (code=${c})`);
      }) as never,
    });
    expect(port).toBe(probe.port);
    expect(logs).toEqual([]);
  });

  it('exits with a clear message when the port is busy and --auto-port is not set', async () => {
    const probe = await holdPort();
    try {
      const logs: string[] = [];
      let exitCode: number | undefined;
      const sentinel = new Error('__resolveDevPortExitedSentinel__');
      await expect(
        resolveDevPort({
          port: probe.port,
          log: (m) => logs.push(m),
          exit: ((c: number) => {
            exitCode = c;
            throw sentinel;
          }) as never,
        }),
      ).rejects.toThrow(sentinel);
      expect(exitCode).toBe(1);
      const flattened = logs.join('\n');
      expect(flattened).toMatch(/Port .+ is already in use/);
      expect(flattened).toMatch(/--port/);
      expect(flattened).toMatch(/--auto-port/);
    } finally {
      await probe.release();
    }
  });

  it('auto-picks the next free port when --auto-port is set', async () => {
    const probe = await holdPort();
    try {
      const logs: string[] = [];
      const picked = await resolveDevPort({
        port: probe.port,
        autoPort: true,
        log: (m) => logs.push(m),
        exit: ((c: number) => {
          throw new Error(`should not exit (code=${c})`);
        }) as never,
      });
      expect(picked).toBeGreaterThan(probe.port);
      expect(logs.join('\n')).toMatch(/auto-picked/);
    } finally {
      await probe.release();
    }
  });

  it('falls back to PORT env when --port is not provided', async () => {
    const probe = await holdPort();
    await probe.release();
    const port = await resolveDevPort({
      envPort: String(probe.port),
      exit: ((c: number) => {
        throw new Error(`should not exit (code=${c})`);
      }) as never,
      log: () => {},
    });
    expect(port).toBe(probe.port);
  });

  it('treats --port 0 as "fall back to default" rather than passing 0 through', async () => {
    // `parseInt('0', 10) === 0` is technically a valid Node ephemeral-port
    // signal, but for a dev server the user can't predict which port to point
    // their client at. We fall back to DEFAULT_DEV_PORT (3000) and document
    // this in setup-project.md.
    const logs: string[] = [];
    const port = await resolveDevPort({
      port: 0,
      log: (m) => logs.push(m),
      exit: ((c: number) => {
        throw new Error(`should not exit (code=${c})`);
      }) as never,
    });
    expect(port).toBe(3000);
  });

  it('ignores an empty-string PORT env var', async () => {
    const port = await resolveDevPort({
      envPort: '',
      log: () => {},
      exit: ((c: number) => {
        throw new Error(`should not exit (code=${c})`);
      }) as never,
    });
    expect(port).toBe(3000);
  });

  it('ignores a NaN PORT env var', async () => {
    const port = await resolveDevPort({
      envPort: 'not-a-number',
      log: () => {},
      exit: ((c: number) => {
        throw new Error(`should not exit (code=${c})`);
      }) as never,
    });
    expect(port).toBe(3000);
  });

  it('shows the conflicting process when --show-conflict is set (POSIX best-effort)', async () => {
    const probe = await holdPort();
    try {
      const logs: string[] = [];
      const sentinel = new Error('__resolveDevPortExitedSentinel__');
      await expect(
        resolveDevPort({
          port: probe.port,
          showConflict: true,
          log: (m) => logs.push(m),
          exit: ((c: number) => {
            throw sentinel;
          }) as never,
        }),
      ).rejects.toThrow(sentinel);
      const flattened = logs.join('\n');
      // Either we got lsof output (Holder of <port>:) or a clean "couldn't identify" fallback.
      expect(flattened).toMatch(/Holder of|could not identify the holder/);
    } finally {
      await probe.release();
    }
  });
});
