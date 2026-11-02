/**
 * Proposal 1.7: a Unix socket is the only boundary a socket server has, so it is created owner-only
 * with no window, in a directory nobody else can write to, and a start never removes a live socket,
 * a file that is not a socket, or another user's socket.
 */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';

import * as utils from '@frontmcp/utils';

import {
  SocketInUseError,
  SocketPathConflictError,
  SocketPermissionError,
  UnsafeSocketDirectoryError,
} from '../../../errors/transport.errors';
import { ExpressHostAdapter } from '../express.host.adapter';

jest.mock('../base.host.adapter', () => {
  class HostServerAdapter {}
  return { HostServerAdapter };
});

jest.mock('@frontmcp/utils', () => {
  const actual = jest.requireActual('@frontmcp/utils');
  return { ...actual, chmod: jest.fn(actual.chmod), lstat: jest.fn(actual.lstat) };
});

const actualUtils = jest.requireActual<typeof utils>('@frontmcp/utils');
const chmodMock = utils.chmod as jest.MockedFunction<typeof utils.chmod>;
const lstatMock = utils.lstat as jest.MockedFunction<typeof utils.lstat>;

const posixIt = process.platform === 'win32' ? it.skip : it;

function health(socketPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    http
      .get({ socketPath, path: '/health', agent: false }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      })
      .once('error', reject);
  });
}

function leaveStaleSocket(socketPath: string): void {
  const script = `require('net').createServer().listen(${JSON.stringify(socketPath)}, () => process.kill(process.pid, 'SIGKILL'))`;
  spawnSync(process.execPath, ['-e', script]);
}

describe('ExpressHostAdapter on a Unix socket', () => {
  let directory: string;
  let socketPath: string;
  let adapter: ExpressHostAdapter | undefined;
  let log: jest.SpyInstance;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fmcp-'));
    socketPath = path.join(directory, 's.sock');
    chmodMock.mockClear();
    log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(async () => {
    await adapter?.stop(0);
    adapter = undefined;
    log.mockRestore();
    chmodMock.mockImplementation(actualUtils.chmod);
    lstatMock.mockImplementation(actualUtils.lstat);
    fs.rmSync(directory, { recursive: true, force: true });
  });

  async function start(): Promise<ExpressHostAdapter> {
    const started = new ExpressHostAdapter();
    started.registerRoute('GET', '/health', (_req, res) => res.status(200).json({ ok: true }));
    await started.start(socketPath);
    adapter = started;
    return started;
  }

  posixIt('creates the socket owner-only (0600)', async () => {
    await start();

    expect(fs.lstatSync(socketPath).mode & 0o777).toBe(0o600);
    expect(await health(socketPath)).toBe(200);
  });

  posixIt('binds owner-only before any chmod, so there is no window', async () => {
    chmodMock.mockResolvedValue(undefined);

    await start();

    expect(fs.lstatSync(socketPath).mode & 0o777).toBe(0o600);
  });

  posixIt('restores the process umask after binding', async () => {
    const before = process.umask();

    await start();

    expect(process.umask()).toBe(before);
  });

  posixIt('fails startup and closes the listener when chmod fails', async () => {
    chmodMock.mockRejectedValue(Object.assign(new Error('EPERM'), { code: 'EPERM' }));

    await expect(start()).rejects.toBeInstanceOf(SocketPermissionError);
    expect(fs.existsSync(socketPath)).toBe(false);
  });

  posixIt('fails startup when the socket does not end up 0600', async () => {
    lstatMock.mockImplementation(async (p) => {
      const stats = await actualUtils.lstat(p);
      return Object.assign(stats, { mode: (stats.mode & ~0o777) | 0o660 });
    });

    await expect(start()).rejects.toThrow(/0660/);
    expect(fs.existsSync(socketPath)).toBe(false);
  });

  posixIt('refuses a directory the group or others can write, naming the path and the mode', async () => {
    fs.chmodSync(directory, 0o777);

    const failure = start();

    await expect(failure).rejects.toBeInstanceOf(UnsafeSocketDirectoryError);
    await expect(failure).rejects.toThrow(directory);
    await expect(failure).rejects.toThrow('0777');
    expect(fs.existsSync(socketPath)).toBe(false);
  });

  posixIt('accepts a world-writable directory with the sticky bit, as /tmp is', async () => {
    fs.chmodSync(directory, 0o1777);

    await start();

    expect(await health(socketPath)).toBe(200);
  });

  posixIt('replaces a stale socket a crashed server left behind', async () => {
    leaveStaleSocket(socketPath);
    expect(fs.lstatSync(socketPath).isSocket()).toBe(true);

    await start();

    expect(await health(socketPath)).toBe(200);
  });

  posixIt('refuses to take over a live socket, and the server on it keeps serving', async () => {
    const first = net.createServer((socket) => socket.end('first'));
    await new Promise<void>((resolve) => first.listen(socketPath, resolve));
    try {
      await expect(start()).rejects.toBeInstanceOf(SocketInUseError);

      const reply = await new Promise<string>((resolve) => {
        const client = net.connect(socketPath);
        let data = '';
        client.on('data', (chunk) => (data += chunk));
        client.on('end', () => resolve(data));
      });
      expect(reply).toBe('first');
    } finally {
      await new Promise<void>((resolve) => first.close(() => resolve()));
    }
  });

  posixIt('refuses to remove a regular file at the path', async () => {
    fs.writeFileSync(socketPath, 'keep me');

    await expect(start()).rejects.toBeInstanceOf(SocketPathConflictError);
    expect(fs.readFileSync(socketPath, 'utf8')).toBe('keep me');
  });

  posixIt("refuses to remove another user's socket", async () => {
    leaveStaleSocket(socketPath);
    lstatMock.mockImplementation(async (p) => {
      const stats = await actualUtils.lstat(p);
      return Object.assign(stats, { uid: stats.uid + 1 });
    });

    await expect(start()).rejects.toThrow(/another user/);
    expect(fs.existsSync(socketPath)).toBe(true);
  });

  posixIt('reports a probe failure other than a refused connection instead of unlinking', async () => {
    leaveStaleSocket(socketPath);
    const connect = jest.spyOn(net, 'connect').mockImplementation(() => {
      const socket = new net.Socket();
      process.nextTick(() => socket.emit('error', Object.assign(new Error('EACCES'), { code: 'EACCES' })));
      return socket;
    });
    try {
      await expect(start()).rejects.toThrow(/EACCES/);
      expect(fs.existsSync(socketPath)).toBe(true);
    } finally {
      connect.mockRestore();
    }
  });

  posixIt('still ends up 0600 where the umask cannot be set (a worker thread)', async () => {
    const umask = jest.spyOn(process, 'umask').mockImplementation(((mask?: number) => {
      if (mask !== undefined) throw new Error('ERR_WORKER_UNSUPPORTED_OPERATION');
      return 0o022;
    }) as typeof process.umask);
    try {
      await start();
    } finally {
      umask.mockRestore();
    }

    expect(fs.lstatSync(socketPath).mode & 0o777).toBe(0o600);
  });

  posixIt('goes on when the stale socket disappears before the probe', async () => {
    leaveStaleSocket(socketPath);
    const connect = jest.spyOn(net, 'connect').mockImplementation(() => {
      const socket = new net.Socket();
      fs.unlinkSync(socketPath);
      process.nextTick(() => socket.emit('error', Object.assign(new Error('ENOENT'), { code: 'ENOENT' })));
      return socket;
    });
    try {
      await start();
    } finally {
      connect.mockRestore();
    }

    expect(await health(socketPath)).toBe(200);
  });

  posixIt('reports an lstat failure other than a missing path', async () => {
    lstatMock.mockRejectedValue(Object.assign(new Error('EACCES'), { code: 'EACCES' }));

    await expect(start()).rejects.toThrow('EACCES');
  });

  it('applies none of this to a Windows named pipe', async () => {
    const platform = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { value: 'win32' });
    fs.chmodSync(directory, 0o777);
    try {
      await start();
      expect(chmodMock).not.toHaveBeenCalled();
    } finally {
      if (platform) Object.defineProperty(process, 'platform', platform);
    }
  });
});
