import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';

import { createSharedServerSecret, deriveSharedServerKeys } from '@frontmcp/auth';
import { createMemoryStorage, type RootStorage } from '@frontmcp/utils';

import { startIdentityStub, type IdentityStub } from '../../__test-utils__/helpers/shared-server-stub';
import { SharedServerIdentityError, SharedServerStartError } from '../../errors';
import {
  ensureSharedServer,
  type AttachedSharedServer,
  type EnsureSharedServerOptions,
  type SpawnedServer,
} from '../ensure-shared-server';
import { SHARED_DRAIN_PATH, SHARED_IDENTIFY_PATH } from '../shared-endpoint';
import { prepareSharedDirectory, sharedServerFiles, writeServerRecord, type SharedServerFiles } from '../shared-files';
import { SharedStartLock } from '../start-lock';

const posixOnly = process.platform === 'win32' ? describe.skip : describe;

const SERVER_NAME = 'notes-server';

posixOnly('ensureSharedServer', () => {
  let home: string;
  let previousHome: string | undefined;
  let files: SharedServerFiles;
  let lockStore: RootStorage;
  const stubs: IdentityStub[] = [];

  beforeEach(async () => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'sdk-shared-ensure-'));
    previousHome = process.env['FRONTMCP_HOME'];
    process.env['FRONTMCP_HOME'] = home;
    files = sharedServerFiles('notes');
    await prepareSharedDirectory(files);
    lockStore = createMemoryStorage();
    await lockStore.connect();
  });

  afterEach(async () => {
    await Promise.all(stubs.splice(0).map((stub) => stub.close()));
    await lockStore.disconnect();
    if (previousHome === undefined) delete process.env['FRONTMCP_HOME'];
    else process.env['FRONTMCP_HOME'] = previousHome;
    fs.rmSync(home, { recursive: true, force: true });
  });

  /** Start a server that proves `secret` and record it, as a spawned shared server does once it listens. */
  async function startRecordedServer(
    secret: string,
    pid: number,
    stubOptions: Partial<Parameters<typeof startIdentityStub>[0]> = {},
    name = SERVER_NAME,
  ): Promise<IdentityStub> {
    const stub = await startIdentityStub({ secret, behavior: 'prove', ...stubOptions });
    stubs.push(stub);
    await writeServerRecord(files, { name, transport: 'http', port: stub.port, path: '/mcp', pid, secret });
    return stub;
  }

  async function attach(overrides: Partial<EnsureSharedServerOptions> = {}): Promise<AttachedSharedServer> {
    const outcome = await ensureSharedServer(options(overrides));
    if (!('server' in outcome)) throw new Error(`expected to attach, but: ${outcome.embedded}`);
    return outcome.server;
  }

  function options(overrides: Partial<EnsureSharedServerOptions> = {}): EnsureSharedServerOptions {
    return {
      key: 'notes',
      name: SERVER_NAME,
      transport: 'http',
      files,
      openLock: async () => ({ lock: new SharedStartLock(lockStore, 'notes'), close: async () => undefined }),
      spawnServer: () => {
        throw new Error('no server should be spawned');
      },
      version: '1.0.0',
      replaceOlder: true,
      budgetMs: 10_000,
      pollMs: 20,
      logger: { warn: jest.fn() },
      ...overrides,
    };
  }

  it('attaches to the running server without taking the start lock', async () => {
    const secret = createSharedServerSecret();
    const stub = await startRecordedServer(secret, 1234);
    const openLock = jest.fn();

    const attached = await attach({ openLock });

    expect(attached).toMatchObject({ pid: 1234, url: `${stub.endpoint.baseUrl}/mcp`, version: '1.0.0' });
    expect(attached.token).toBe(deriveSharedServerKeys(secret).token);
    expect(openLock).not.toHaveBeenCalled();
  });

  it('starts one server when several launchers find none', async () => {
    const secret = createSharedServerSecret();
    let spawned = 0;
    const holdsTheLock: Array<Promise<boolean>> = [];
    const spawnServer = (startLockHolder: string): SpawnedServer => {
      spawned++;
      holdsTheLock.push(new SharedStartLock(lockStore, 'notes', 10, startLockHolder).renew());
      setTimeout(() => void startRecordedServer(secret, 99), 200);
      return { exitReason: undefined };
    };

    const attached = await Promise.all(Array.from({ length: 5 }, () => attach({ spawnServer })));

    expect(spawned).toBe(1);
    expect(await Promise.all(holdsTheLock)).toEqual([true]);
    expect(new Set(attached.map(({ url }) => url)).size).toBe(1);
    expect(attached.every(({ pid }) => pid === 99)).toBe(true);
  });

  it('never sends the token to a squatter on the recorded endpoint, and starts a server of its own', async () => {
    const recordedSecret = createSharedServerSecret();
    const squatter = await startIdentityStub({ secret: createSharedServerSecret(), behavior: 'replay' });
    stubs.push(squatter);
    await writeServerRecord(files, {
      name: SERVER_NAME,
      transport: 'http',
      port: squatter.port,
      path: '/',
      pid: 1,
      secret: recordedSecret,
    });
    const freshSecret = createSharedServerSecret();
    const logger = { warn: jest.fn() };

    const attached = await attach({
      logger,
      spawnServer: () => {
        void startRecordedServer(freshSecret, 2);
        return { exitReason: undefined };
      },
    });

    expect(attached.token).toBe(deriveSharedServerKeys(freshSecret).token);
    expect(squatter.requests.length).toBeGreaterThan(0);
    for (const request of squatter.requests) {
      expect(request.headers['authorization']).toBeUndefined();
      expect(request.body).not.toContain(deriveSharedServerKeys(recordedSecret).token);
    }
    expect(logger.warn).toHaveBeenCalledWith(
      `the process at ${squatter.endpoint.id} did not prove it is the shared server "notes"; it was not sent the token`,
    );
  });

  it('over loopback HTTP, sends no request to a process that took the port of a server that stopped', async () => {
    const secret = createSharedServerSecret();
    const server = await startRecordedServer(secret, 5);
    const attached = await attach();
    const answered = await attached.fetch(`${attached.url}`, { method: 'POST', body: '{}' });
    await answered.body?.cancel();
    expect(server.requests.at(-1)?.path).toBe('/mcp');

    await server.close();
    const squatter = await startIdentityStub({
      secret: createSharedServerSecret(),
      behavior: 'garbage',
      port: server.port,
    });
    stubs.push(squatter);

    for (let attempt = 0; attempt < 2; attempt++) {
      await expect(
        attached.fetch(attached.url, {
          method: 'POST',
          headers: { authorization: `Bearer ${attached.token}` },
          body: '{}',
        }),
      ).rejects.toThrow(new SharedServerIdentityError(squatter.endpoint.id));
    }
    expect(squatter.requests.length).toBeGreaterThan(0);
    for (const request of squatter.requests) {
      expect(request.path).toBe(SHARED_IDENTIFY_PATH);
      expect(request.headers['authorization']).toBeUndefined();
    }
  });

  it('sends requests over a Unix socket without challenging the server each time', async () => {
    const secret = createSharedServerSecret();
    const stub = await startIdentityStub({ secret, behavior: 'prove', socketPath: files.socketPath });
    stubs.push(stub);
    await writeServerRecord(files, { name: SERVER_NAME, transport: 'unix', path: '/', pid: 6, secret });

    const attached = await attach({ transport: 'unix' });
    expect(attached.url).toBe('http://localhost/');
    const answered = await attached.fetch(attached.url, { method: 'POST', body: '{}' });
    await answered.body?.cancel();
    expect(stub.requests.map(({ path: requested }) => requested)).toEqual([SHARED_IDENTIFY_PATH, '/']);
  });

  it('does not start its server on the socket while a server that is exiting still holds it', async () => {
    const exiting = await startIdentityStub({
      secret: createSharedServerSecret(),
      behavior: 'exiting',
      socketPath: files.socketPath,
    });
    stubs.push(exiting);
    let socketHeld = true;
    const secret = createSharedServerSecret();
    const spawnServer = jest.fn((): SpawnedServer => {
      if (socketHeld) return { exitReason: 'it exited with code 1' };
      void startIdentityStub({ secret, behavior: 'prove', socketPath: files.socketPath }).then(async (stub) => {
        stubs.push(stub);
        await writeServerRecord(files, { name: SERVER_NAME, transport: 'unix', path: '/', pid: 25, secret });
      });
      return { exitReason: undefined };
    });

    const ensuring = ensureSharedServer(options({ transport: 'unix', spawnServer }));
    await new Promise((resolve) => setTimeout(resolve, 300));
    await exiting.close();
    socketHeld = false;

    await expect(ensuring).resolves.toMatchObject({ server: { pid: 25 } });
    expect(spawnServer).toHaveBeenCalledTimes(1);
  });

  it('ignores a record of the other transport', async () => {
    const secret = createSharedServerSecret();
    await startRecordedServer(secret, 7);
    await expect(
      ensureSharedServer(options({ transport: 'unix', budgetMs: 100, spawnServer: () => ({ exitReason: undefined }) })),
    ).rejects.toThrow(SharedServerStartError);
  });

  it('fails when the server it started exits', async () => {
    await expect(
      ensureSharedServer(options({ spawnServer: () => ({ exitReason: 'it exited with code 1' }) })),
    ).rejects.toThrow(new SharedServerStartError('notes', 'it exited with code 1'));
  });

  it('waits for the server another launcher starts when that launcher took its lock and its own server stopped', async () => {
    const secret = createSharedServerSecret();
    const spawned: { exitReason: string | undefined } = { exitReason: undefined };
    const spawnServer = (startLockHolder: string): SpawnedServer => {
      setTimeout(async () => {
        await new SharedStartLock(lockStore, 'notes', 10, startLockHolder).release();
        await new SharedStartLock(lockStore, 'notes').acquire();
        spawned.exitReason = 'it exited with code 1';
        setTimeout(() => void startRecordedServer(secret, 42), 100);
      }, 50);
      return spawned;
    };

    await expect(attach({ spawnServer })).resolves.toMatchObject({ pid: 42 });
  });

  it('fails when no server answers within its attach budget', async () => {
    await expect(
      ensureSharedServer(options({ budgetMs: 100, spawnServer: () => ({ exitReason: undefined }) })),
    ).rejects.toThrow('The shared server "notes" did not start: no server proved its identity within 100 ms');
  });

  it('fails within its attach budget when the recorded server does not answer', async () => {
    const connections = new Set<net.Socket>();
    const wedged = net.createServer((socket) => void connections.add(socket));
    await new Promise<void>((resolve) => wedged.listen(0, '127.0.0.1', resolve));
    try {
      const { port } = wedged.address() as net.AddressInfo;
      await writeServerRecord(files, {
        name: SERVER_NAME,
        transport: 'http',
        port,
        path: '/',
        pid: 8,
        secret: createSharedServerSecret(),
      });
      const started = Date.now();
      await expect(
        ensureSharedServer(options({ budgetMs: 400, spawnServer: () => ({ exitReason: undefined }) })),
      ).rejects.toThrow(SharedServerStartError);
      expect(Date.now() - started).toBeLessThan(3_000);
    } finally {
      for (const socket of connections) socket.destroy();
      await new Promise<void>((resolve) => wedged.close(() => resolve()));
    }
  });

  describe('the version handshake', () => {
    it.each([
      ['the same version', '1.0.0'],
      ['a newer version', '1.2.0'],
    ])('attaches to a server of %s', async (_, version) => {
      const secret = createSharedServerSecret();
      await startRecordedServer(secret, 11, { version });
      await expect(attach()).resolves.toMatchObject({ pid: 11, version });
    });

    it('never attaches to an older server, and runs embedded when it may not replace it', async () => {
      const secret = createSharedServerSecret();
      const older = await startRecordedServer(secret, 12, { version: '0.9.0' });
      const openLock = jest.fn();

      await expect(ensureSharedServer(options({ replaceOlder: false, openLock }))).resolves.toEqual({
        embedded: "the shared server runs version 0.9.0, older than this session's 1.0.0, and replaceOlder is off",
      });
      expect(openLock).not.toHaveBeenCalled();
      expect(older.requests.every(({ path: requested }) => requested === SHARED_IDENTIFY_PATH)).toBe(true);
    });

    it('runs embedded beside a server whose version it can not order against its own', async () => {
      await startRecordedServer(createSharedServerSecret(), 13, { version: 'nightly' });
      await expect(ensureSharedServer(options())).resolves.toEqual({
        embedded: "the shared server runs version nightly, which can't be ordered against this session's 1.0.0",
      });
    });

    it('drains an older server with its token and version, waits for it to go, then starts and attaches to its own', async () => {
      const olderSecret = createSharedServerSecret();
      const older = await startRecordedServer(olderSecret, 14, { version: '0.9.0' });
      const freshSecret = createSharedServerSecret();
      const spawnServer = jest.fn((): SpawnedServer => {
        void startRecordedServer(freshSecret, 15);
        return { exitReason: undefined };
      });

      const attached = await attach({ spawnServer });

      expect(attached).toMatchObject({ pid: 15, version: '1.0.0' });
      expect(spawnServer).toHaveBeenCalledTimes(1);
      const drains = older.requests.filter(({ path: requested }) => requested === SHARED_DRAIN_PATH);
      expect(drains).toHaveLength(1);
      expect(drains[0]?.headers['authorization']).toBe(`Bearer ${deriveSharedServerKeys(olderSecret).token}`);
      expect(JSON.parse(drains[0]?.body ?? '{}')).toEqual({ version: '1.0.0' });
    });

    it('does not start its own server while the older one still listens after agreeing to drain', async () => {
      const older = await startRecordedServer(createSharedServerSecret(), 16, {
        version: '0.9.0',
        drain: { status: 202, close: false },
      });
      const spawnServer = jest.fn((): SpawnedServer => ({ exitReason: undefined }));
      const ensuring = ensureSharedServer(options({ spawnServer, budgetMs: 2_000 }));
      await new Promise((resolve) => setTimeout(resolve, 300));
      await writeServerRecord(files, {
        name: SERVER_NAME,
        transport: 'http',
        port: 1,
        path: '/',
        pid: 1,
        secret: createSharedServerSecret(),
      });
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(spawnServer).not.toHaveBeenCalled();

      await older.close();
      await startRecordedServer(createSharedServerSecret(), 17);
      await expect(ensuring).resolves.toMatchObject({ server: { pid: 17 } });
    });

    it('leaves the drain to the session that holds the start lock, and attaches to the server it starts', async () => {
      const older = await startRecordedServer(createSharedServerSecret(), 18, { version: '0.9.0' });
      const other = new SharedStartLock(lockStore, 'notes');
      expect(await other.acquire()).toBe(true);
      const ensuring = ensureSharedServer(options());
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(older.requests.some(({ path: requested }) => requested === SHARED_DRAIN_PATH)).toBe(false);
      await older.close();
      await startRecordedServer(createSharedServerSecret(), 19, { version: '1.0.0' });
      await expect(ensuring).resolves.toMatchObject({ server: { pid: 19 } });
    });

    it.each([
      ['the same version', '1.0.0'],
      ['an older version', '0.9.0'],
    ])('never attaches to, nor drains, a server of another info.name that took its key, at %s', async (_, version) => {
      const other = await startRecordedServer(createSharedServerSecret(), 22, { version }, 'another-server');
      const openLock = jest.fn();

      await expect(ensureSharedServer(options({ openLock }))).resolves.toEqual({
        embedded: 'its key is taken by a server of another info.name; give each server a key of its own',
      });
      expect(openLock).not.toHaveBeenCalled();
      expect(other.requests.every(({ path: requested }) => requested === SHARED_IDENTIFY_PATH)).toBe(true);
    });

    it('starts its own server when the server of another info.name that took its key is gone', async () => {
      const stale = await startRecordedServer(createSharedServerSecret(), 23, {}, 'another-server');
      await stale.close();
      const secret = createSharedServerSecret();

      const attached = await attach({
        spawnServer: () => {
          void startRecordedServer(secret, 24);
          return { exitReason: undefined };
        },
      });

      expect(attached).toMatchObject({ pid: 24 });
    });

    it('keeps asking until its attach budget runs out when the older server refuses to drain', async () => {
      const older = await startRecordedServer(createSharedServerSecret(), 20, {
        version: '0.9.0',
        drain: { status: 409, close: false },
      });
      await expect(
        ensureSharedServer(options({ budgetMs: 300, spawnServer: () => ({ exitReason: undefined }) })),
      ).rejects.toThrow(SharedServerStartError);
      expect(older.requests.filter(({ path: requested }) => requested === SHARED_DRAIN_PATH).length).toBeGreaterThan(0);
    });
  });

  it('releases the start lock once it attached', async () => {
    const secret = createSharedServerSecret();
    await ensureSharedServer(
      options({
        spawnServer: () => {
          void startRecordedServer(secret, 3);
          return { exitReason: undefined };
        },
      }),
    );
    await expect(new SharedStartLock(lockStore, 'notes').acquire()).resolves.toBe(true);
  });
});
