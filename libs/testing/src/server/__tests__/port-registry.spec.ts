import { createServer, type AddressInfo } from 'net';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { getPortRange, releaseAllPorts, reservePort } from '../port-registry';

const uid = typeof process.getuid === 'function' ? process.getuid() : undefined;
const lockDirName = uid === undefined ? 'frontmcp-testing-ports' : `frontmcp-testing-ports-${uid}`;

/** This user's lock directory under the current temporary directory, created as the registry creates it. */
function userLockDir(): string {
  const dir = path.join(os.tmpdir(), lockDirName);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

function canListen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.listen(port, () => server.close(() => resolve(true)));
  });
}

/** A port the system reports free right now, so the test does not depend on a fixed port being unused. */
function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      server.close(() => resolve(port));
    });
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
    const dir = userLockDir();
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
    const dir = userLockDir();
    const freePort = await findFreePort();
    const lock = path.join(dir, `${freePort}.lock`);
    fs.writeFileSync(lock, JSON.stringify({ pid: 2 ** 22 + 12345, at: Date.now() }));
    const { port, release } = await reservePort('mock-cimd', freePort);
    expect(port).toBe(freePort);
    await release();
    expect(fs.existsSync(lock)).toBe(false);
  });

  describe('lock directory', () => {
    const posixIt = process.platform === 'win32' ? it.skip : it;
    let tmp: string;

    beforeEach(() => {
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'port-registry-'));
      jest.spyOn(require('node:os') as typeof os, 'tmpdir').mockReturnValue(tmp);
    });

    afterEach(() => {
      jest.restoreAllMocks();
      fs.rmSync(tmp, { recursive: true, force: true });
    });

    posixIt('keeps the lock files in a directory only this user can open', async () => {
      const { port, release } = await reservePort('mock-oauth');
      const dir = path.join(tmp, lockDirName);
      expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
      expect(fs.existsSync(path.join(dir, `${port}.lock`))).toBe(true);
      await release();
    });

    posixIt.each(['frontmcp-testing-ports', lockDirName])(
      'ignores a lock in %s when other users can write to the directory',
      async (name) => {
        const dir = path.join(tmp, name);
        fs.mkdirSync(dir, { recursive: true });
        fs.chmodSync(dir, 0o777);
        const preferred = getPortRange('mock-api').start + 1;
        fs.writeFileSync(path.join(dir, `${preferred}.lock`), JSON.stringify({ pid: process.ppid, at: Date.now() }));
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        const { port, release } = await reservePort('mock-api', preferred);
        warn.mockRestore();
        expect(port).toBe(preferred);
        await release();
      },
    );
  });
});
