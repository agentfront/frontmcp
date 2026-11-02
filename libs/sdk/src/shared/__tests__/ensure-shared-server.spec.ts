import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { createSharedServerSecret, deriveSharedServerKeys } from '@frontmcp/auth';
import { createMemoryStorage, type RootStorage } from '@frontmcp/utils';

import { startIdentityStub, type IdentityStub } from '../../__test-utils__/helpers/shared-server-stub';
import { SharedServerIdentityError, SharedServerStartError } from '../../errors';
import { ensureSharedServer, type EnsureSharedServerOptions, type SpawnedServer } from '../ensure-shared-server';
import { SHARED_IDENTIFY_PATH } from '../shared-endpoint';
import { prepareSharedDirectory, sharedServerFiles, writeServerRecord, type SharedServerFiles } from '../shared-files';
import { SharedStartLock } from '../start-lock';

const posixOnly = process.platform === 'win32' ? describe.skip : describe;

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
  async function startRecordedServer(secret: string, pid: number): Promise<IdentityStub> {
    const stub = await startIdentityStub({ secret, behavior: 'prove' });
    stubs.push(stub);
    await writeServerRecord(files, { transport: 'http', port: stub.port, path: '/mcp', pid, secret });
    return stub;
  }

  function options(overrides: Partial<EnsureSharedServerOptions> = {}): EnsureSharedServerOptions {
    return {
      key: 'notes',
      transport: 'http',
      files,
      openLock: async () => ({ lock: new SharedStartLock(lockStore, 'notes'), close: async () => undefined }),
      spawnServer: () => {
        throw new Error('no server should be spawned');
      },
      startTimeoutMs: 10_000,
      pollMs: 20,
      logger: { warn: jest.fn() },
      ...overrides,
    };
  }

  it('attaches to the running server without taking the start lock', async () => {
    const secret = createSharedServerSecret();
    const stub = await startRecordedServer(secret, 1234);
    const openLock = jest.fn();

    const attached = await ensureSharedServer(options({ openLock }));

    expect(attached).toMatchObject({ pid: 1234, url: `${stub.endpoint.baseUrl}/mcp` });
    expect(attached.token).toBe(deriveSharedServerKeys(secret).token);
    expect(openLock).not.toHaveBeenCalled();
  });

  it('starts one server when several launchers find none', async () => {
    const secret = createSharedServerSecret();
    let spawned = 0;
    const spawnServer = (): SpawnedServer => {
      spawned++;
      setTimeout(() => void startRecordedServer(secret, 99), 200);
      return { exitReason: undefined };
    };

    const attached = await Promise.all(Array.from({ length: 5 }, () => ensureSharedServer(options({ spawnServer }))));

    expect(spawned).toBe(1);
    expect(new Set(attached.map(({ url }) => url)).size).toBe(1);
    expect(attached.every(({ pid }) => pid === 99)).toBe(true);
  });

  it('never sends the token to a squatter on the recorded endpoint, and starts a server of its own', async () => {
    const recordedSecret = createSharedServerSecret();
    const squatter = await startIdentityStub({ secret: createSharedServerSecret(), behavior: 'replay' });
    stubs.push(squatter);
    await writeServerRecord(files, {
      transport: 'http',
      port: squatter.port,
      path: '/',
      pid: 1,
      secret: recordedSecret,
    });
    const freshSecret = createSharedServerSecret();
    const logger = { warn: jest.fn() };

    const attached = await ensureSharedServer(
      options({
        logger,
        spawnServer: () => {
          void startRecordedServer(freshSecret, 2);
          return { exitReason: undefined };
        },
      }),
    );

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
    const attached = await ensureSharedServer(options());
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
    await writeServerRecord(files, { transport: 'unix', path: '/', pid: 6, secret });

    const attached = await ensureSharedServer(options({ transport: 'unix' }));
    expect(attached.url).toBe('http://localhost/');
    const answered = await attached.fetch(attached.url, { method: 'POST', body: '{}' });
    await answered.body?.cancel();
    expect(stub.requests.map(({ path: requested }) => requested)).toEqual([SHARED_IDENTIFY_PATH, '/']);
  });

  it('ignores a record of the other transport', async () => {
    const secret = createSharedServerSecret();
    await startRecordedServer(secret, 7);
    await expect(
      ensureSharedServer(
        options({ transport: 'unix', startTimeoutMs: 100, spawnServer: () => ({ exitReason: undefined }) }),
      ),
    ).rejects.toThrow(SharedServerStartError);
  });

  it('fails when the server it started exits', async () => {
    await expect(
      ensureSharedServer(options({ spawnServer: () => ({ exitReason: 'it exited with code 1' }) })),
    ).rejects.toThrow(new SharedServerStartError('notes', 'it exited with code 1'));
  });

  it('fails when no server answers in time', async () => {
    await expect(
      ensureSharedServer(options({ startTimeoutMs: 100, spawnServer: () => ({ exitReason: undefined }) })),
    ).rejects.toThrow('The shared server "notes" did not start: no server proved its identity within 100 ms');
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
