/**
 * A stdio session attached to a shared local server, both in this process: the session's frames reach the server's
 * tools through the server's HTTP flows, and the server asks for the token on every request.
 */
import 'reflect-metadata';

import * as fs from 'node:fs';
import * as http from 'node:http';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { PassThrough } from 'node:stream';

import { createSharedServerNonce, deriveSharedServerKeys, verifySharedServerIdentity } from '@frontmcp/auth';
import type { RootStorage } from '@frontmcp/utils';

import { clientOf, initialize, pidOf, post } from '../../__test-utils__/helpers/shared-session-client';
import { App, LogLevel, Tool, ToolContext, type FrontMcpConfigInput } from '../../common';
import { SharedServerStartError } from '../../errors';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';
import { attachSharedSession, type AttachSharedSessionOptions } from '../shared-attach';
import { runEmbeddedServer } from '../shared-embedded';
import { SHARED_DRAIN_PATH, SHARED_IDENTIFY_PATH } from '../shared-endpoint';
import { prepareSharedDirectory, readServerRecord, sharedServerFiles, type SharedServerRecord } from '../shared-files';
import { serveShared, type ServeSharedOptions, type SharedServerHandle } from '../shared-serve';
import { parseSharedServerOptions, type ResolvedSharedServerOptions } from '../shared-server.options';
import { openStartLockStorage, SharedStartLock } from '../start-lock';

@Tool({ name: 'server_pid', inputSchema: {} })
class ServerPidTool extends ToolContext {
  async execute() {
    return { pid: process.pid };
  }
}

@App({ id: 'shared', name: 'Shared', tools: [ServerPidTool] })
class SharedApp {}

@App({ id: 'own-auth', name: 'OwnAuth', tools: [ServerPidTool], auth: { mode: 'public' } })
class OwnAuthApp {}

@App({
  id: 'standalone-own-auth',
  name: 'StandaloneOwnAuth',
  tools: [ServerPidTool],
  standalone: true,
  auth: { mode: 'public' },
})
class StandaloneOwnAuthApp {}

const config: FrontMcpConfigInput = {
  info: { name: 'shared-spec', version: '1.0.0' },
  apps: [SharedApp],
  logging: { level: LogLevel.Off, enableConsole: false },
};

const verboseConfig: FrontMcpConfigInput = { ...config, logging: { level: LogLevel.Verbose, enableConsole: true } };

const create = (parsed: ConstructorParameters<typeof FrontMcpInstance>[0]) => new FrontMcpInstance(parsed);

function sharedOptions(transport: 'unix' | 'http'): ResolvedSharedServerOptions {
  return parseSharedServerOptions({ key: 'spec', transport, idleTimeoutMs: false, checkout: false });
}

function serving(transport: 'unix' | 'http', overrides: Partial<ServeSharedOptions> = {}): ServeSharedOptions {
  return { config, options: sharedOptions(transport), create, exit: jest.fn(), ...overrides };
}

function sessionOptions(
  transport: 'unix' | 'http',
  input: PassThrough,
  output: PassThrough,
  overrides: Partial<AttachSharedSessionOptions> = {},
): AttachSharedSessionOptions {
  return {
    ...sharedOptions(transport),
    version: '1.0.0',
    input,
    output,
    embed: () => runEmbeddedServer(config, 'spec', create),
    ...overrides,
  };
}

/** `create`, with `beforeStart` run once the server is ready, just before it listens. */
function createRunning(beforeStart: () => Promise<void>) {
  return (parsed: ConstructorParameters<typeof FrontMcpInstance>[0]) => {
    const instance = create(parsed);
    const start = instance.start.bind(instance);
    instance.start = async () => {
      await beforeStart();
      await start();
    };
    return instance;
  };
}

const posixOnly = process.platform === 'win32' ? describe.skip : describe;

// Each test starts real servers, with their SQLite start lock, and attaches sessions to them.
jest.setTimeout(20_000);

posixOnly('a shared local server', () => {
  let home: string;
  let previousHome: string | undefined;
  let servers: SharedServerHandle[];
  let lockStorages: RootStorage[];

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'sdk-shared-'));
    previousHome = process.env['FRONTMCP_HOME'];
    process.env['FRONTMCP_HOME'] = home;
    servers = [];
    lockStorages = [];
  });

  afterEach(async () => {
    for (const server of servers) await server.close();
    for (const storage of lockStorages) await storage.disconnect();
    if (previousHome === undefined) delete process.env['FRONTMCP_HOME'];
    else process.env['FRONTMCP_HOME'] = previousHome;
    fs.rmSync(home, { recursive: true, force: true });
  });

  async function serve(transport: 'unix' | 'http', serverConfig = config): Promise<SharedServerRecord> {
    servers.push(await serveShared(serving(transport, { config: serverConfig })));
    const record = await readServerRecord(sharedServerFiles('spec'));
    if (!record) throw new Error('the shared server wrote no record');
    return record;
  }

  describe.each(['unix', 'http'] as const)('over %s', (transport) => {
    it('serves an attached session through its flows', async () => {
      await serve(transport);
      const input = new PassThrough();
      const output = new PassThrough();
      const session = attachSharedSession(
        sessionOptions(transport, input, output, {
          spawnServer: () => {
            throw new Error('the running server should be found');
          },
        }),
      );
      const client = clientOf(input, output);
      try {
        await session.attached;
        expect((await client.request(initialize)).result).toBeDefined();
        client.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
        const call = await client.request({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: { name: 'server_pid', arguments: {} },
        });
        expect(pidOf(call)).toBe(process.pid);
      } finally {
        await session.stop();
      }
    });

    it('starts the server when none runs, then attaches to it', async () => {
      const input = new PassThrough();
      const output = new PassThrough();
      let spawned = 0;
      const session = attachSharedSession(
        sessionOptions(transport, input, output, {
          spawnServer: (startLockHolder) => {
            spawned++;
            void serveShared(serving(transport, { startLockHolder })).then((server) => servers.push(server));
            return { exitReason: undefined };
          },
        }),
      );
      const client = clientOf(input, output);
      try {
        expect((await client.request(initialize)).result).toBeDefined();
        await session.attached;
        expect(spawned).toBe(1);
      } finally {
        await session.stop();
      }
    });

    it('runs the server in its own process, announced once, when the server it started exits', async () => {
      const input = new PassThrough();
      const output = new PassThrough();
      const stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
      const session = attachSharedSession(
        sessionOptions(transport, input, output, { spawnServer: () => ({ exitReason: 'it exited with code 1' }) }),
      );
      const client = clientOf(input, output);
      try {
        expect((await client.request(initialize)).result).toBeDefined();
        await session.attached;
        const call = await client.request({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: { name: 'server_pid', arguments: {} },
        });
        expect(pidOf(call)).toBe(process.pid);
        const announced = stderr.mock.calls
          .map(([line]) => String(line))
          .filter((line) => line.includes('in this process'));
        expect(announced).toEqual([
          '[frontmcp shared] warn running the shared server "spec" in this process: ' +
            'The shared server "spec" did not start: it exited with code 1\n',
        ]);
        expect(fs.existsSync(sharedServerFiles('spec').recordFile)).toBe(false);
      } finally {
        stderr.mockRestore();
        await session.stop();
      }
    });

    it('answers the requests it held, and fails, when it can not run the server either', async () => {
      const input = new PassThrough();
      const output = new PassThrough();
      const stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
      const session = attachSharedSession(
        sessionOptions(transport, input, output, {
          spawnServer: () => ({ exitReason: 'it exited with code 1' }),
          embed: () => Promise.reject(new Error('the app failed to start')),
        }),
      );
      const client = clientOf(input, output);
      try {
        const answer = client.request(initialize);
        await expect(session.attached).rejects.toThrow('the app failed to start');
        expect((await answer).error).toMatchObject({
          message: 'dev_reload_deadline',
          data: { error: 'the app failed to start' },
        });
        expect(stderr.mock.calls.map(([line]) => String(line)).join('')).toContain('attach-failed');
      } finally {
        stderr.mockRestore();
        await session.stop();
      }
    });

    it('keeps its files owner-only and removes its record when it stops', async () => {
      const record = await serve(transport);
      const files = sharedServerFiles('spec');
      expect(fs.statSync(files.directory).mode & 0o777).toBe(0o700);
      expect(fs.statSync(files.recordFile).mode & 0o777).toBe(0o600);
      if (transport === 'unix') expect(fs.statSync(files.socketPath).mode & 0o777).toBe(0o600);
      expect(record.pid).toBe(process.pid);

      await (servers.pop() as SharedServerHandle).close();
      expect(fs.existsSync(files.recordFile)).toBe(false);
    });

    it.each([
      ['the app it serves', { splitByApp: true, apps: [OwnAuthApp] }, 'own-auth'],
      ['an app on an endpoint of its own', { apps: [SharedApp, StandaloneOwnAuthApp] }, 'standalone-own-auth'],
    ])('refuses to start when %s has auth of its own, which its token would not guard', async (_, apps, app) => {
      const files = sharedServerFiles('spec');
      await expect(
        serveShared(serving(transport, { config: { ...config, ...apps } as FrontMcpConfigInput })),
      ).rejects.toThrow(
        new SharedServerStartError(
          'spec',
          `app "${app}" has auth of its own (mode public), which the shared server's token would not guard; ` +
            'remove auth from its @App, or serve it without runShared()',
        ),
      );
      expect(fs.existsSync(files.recordFile)).toBe(false);
      expect(fs.existsSync(files.socketPath)).toBe(false);
    });
  });

  it('shuts the server down when its scope cannot take the shared flows', async () => {
    let shutdown: jest.SpyInstance | undefined;
    const failing = (parsed: ConstructorParameters<typeof FrontMcpInstance>[0]) => {
      const instance = create(parsed);
      shutdown = jest.spyOn(instance, 'shutdown');
      const getPrimaryScope = instance.getPrimaryScope.bind(instance);
      jest.spyOn(instance, 'getPrimaryScope').mockImplementation(() => {
        const scope = getPrimaryScope();
        if (scope) jest.spyOn(scope, 'registryFlows').mockRejectedValue(new Error('flows refused'));
        return scope;
      });
      return instance;
    };

    await expect(serveShared(serving('http', { create: failing }))).rejects.toThrow('flows refused');
    expect(shutdown).toHaveBeenCalled();
    expect(fs.existsSync(sharedServerFiles('spec').recordFile)).toBe(false);
  });

  describe('its start lock', () => {
    const anotherStart = new SharedServerStartError('spec', 'another session is starting it');

    async function openLauncherLocks(): Promise<RootStorage> {
      const files = sharedServerFiles('spec');
      await prepareSharedDirectory(files);
      const storage = await openStartLockStorage(files);
      lockStorages.push(storage);
      return storage;
    }

    it('keeps the lock its launcher took while it starts, after the launcher let go, until its record is written', async () => {
      const storage = await openLauncherLocks();
      const launcher = new SharedStartLock(storage, 'spec');
      const other = new SharedStartLock(storage, 'spec');
      expect(await launcher.acquire()).toBe(true);
      await launcher.release();
      let otherTookItWhileStarting: boolean | undefined;

      const starting = createRunning(async () => {
        otherTookItWhileStarting = await other.acquire();
      });
      servers.push(await serveShared(serving('http', { create: starting, startLockHolder: launcher.holder })));

      expect(otherTookItWhileStarting).toBe(false);
      expect(await other.acquire()).toBe(true);
    });

    it('writes no record and stops when another launcher took its lock while it started', async () => {
      const storage = await openLauncherLocks();
      const launcher = new SharedStartLock(storage, 'spec');
      const other = new SharedStartLock(storage, 'spec');
      expect(await launcher.acquire()).toBe(true);
      const files = sharedServerFiles('spec');

      const overtaken = createRunning(async () => {
        await launcher.release();
        expect(await other.acquire()).toBe(true);
      });
      await expect(
        serveShared(serving('unix', { create: overtaken, startLockHolder: launcher.holder })),
      ).rejects.toThrow(anotherStart);

      expect(fs.existsSync(files.recordFile)).toBe(false);
      expect(fs.existsSync(files.socketPath)).toBe(false);
    });

    it('does not start while another launcher starts the server of its key', async () => {
      const storage = await openLauncherLocks();
      expect(await new SharedStartLock(storage, 'spec').acquire()).toBe(true);

      await expect(serveShared(serving('http'))).rejects.toThrow(anotherStart);
      expect(fs.existsSync(sharedServerFiles('spec').recordFile)).toBe(false);
    });
  });

  it('releases what it built when another process holds its socket', async () => {
    const files = sharedServerFiles('spec');
    fs.mkdirSync(files.directory, { recursive: true, mode: 0o700 });
    const holder = net.createServer();
    await new Promise<void>((resolve) => holder.listen(files.socketPath, resolve));
    try {
      await expect(serveShared(serving('unix'))).rejects.toThrow('already in use');
      expect(fs.existsSync(files.recordFile)).toBe(false);
    } finally {
      await new Promise<void>((resolve) => holder.close(() => resolve()));
    }
  });

  it('shuts down the server it started when it can not write its record', async () => {
    const files = sharedServerFiles('spec');
    fs.mkdirSync(`${files.recordFile}.${process.pid}.tmp`, { recursive: true });

    await expect(serveShared(serving('unix'))).rejects.toThrow();
    expect(fs.existsSync(files.socketPath)).toBe(false);
    expect(fs.existsSync(files.recordFile)).toBe(false);
  });

  describe('over loopback HTTP', () => {
    it('ends its MCP session on the server when the session stops', async () => {
      await serve('http');
      const sent = jest.spyOn(globalThis, 'fetch');
      const input = new PassThrough();
      const output = new PassThrough();
      const session = attachSharedSession(sessionOptions('http', input, output));
      try {
        await session.attached;
        await clientOf(input, output).request(initialize);
        await session.stop();
        const ended = sent.mock.calls.find(([, init]) => init?.method === 'DELETE');
        const headers = ended?.[1]?.headers as Record<string, string> | undefined;
        expect(headers?.['mcp-session-id']).toEqual(expect.any(String));
        expect(headers?.['authorization']).toMatch(/^Bearer /);
      } finally {
        sent.mockRestore();
      }
    });

    it('refuses every MCP request without the token', async () => {
      const record = await serve('http');
      const { token } = deriveSharedServerKeys(record.secret);

      expect((await post(record, record.path, {}, initialize)).status).toBe(401);
      expect((await post(record, record.path, { authorization: 'Bearer wrong' }, initialize)).status).toBe(401);
      expect((await post(record, record.path, { authorization: `Bearer ${token}` }, initialize)).status).toBe(200);
    });

    it('proves its identity bound to its own endpoint and the version it runs, without the token', async () => {
      const record = await serve('http');
      const { proofKey } = deriveSharedServerKeys(record.secret);
      const nonce = createSharedServerNonce();

      const answer = await post(record, SHARED_IDENTIFY_PATH, {}, { nonce });
      const { proof } = JSON.parse(answer.body) as { proof: string };

      expect(answer.status).toBe(200);
      const statement = { endpoint: `http://127.0.0.1:${record.port}`, nonce, version: '1.0.0' };
      expect(verifySharedServerIdentity(proofKey, statement, proof)).toBe(true);
      expect((await post(record, SHARED_IDENTIFY_PATH, {}, { nonce: 'short' })).status).toBe(400);
    });

    it('refuses a request from a web page: any Origin, or a Host that is not loopback', async () => {
      const record = await serve('http');
      const { token } = deriveSharedServerKeys(record.secret);
      const credential = { authorization: `Bearer ${token}` };

      for (const origin of ['https://evil.example', `http://127.0.0.1:${record.port}`, 'null']) {
        expect((await post(record, record.path, { ...credential, origin }, initialize)).status).toBe(403);
        expect(
          (await post(record, SHARED_IDENTIFY_PATH, { origin }, { nonce: createSharedServerNonce() })).status,
        ).toBe(403);
      }
      expect(
        (await post(record, record.path, { ...credential, host: `evil.example:${record.port}` }, initialize)).status,
      ).toBe(403);
    });

    it('listens on loopback only', async () => {
      const record = await serve('http');
      const external = Object.values(os.networkInterfaces())
        .flat()
        .find((address) => address && address.family === 'IPv4' && !address.internal);
      if (!external) return;
      const connected = await new Promise<boolean>((resolve) => {
        const request = http.request({
          host: external.address,
          port: record.port,
          path: '/',
          method: 'GET',
          timeout: 2_000,
        });
        request.on('response', () => resolve(true));
        request.on('error', () => resolve(false));
        request.on('timeout', () => {
          request.destroy();
          resolve(false);
        });
        request.end();
      });
      expect(connected).toBe(false);
    });

    it('writes neither its secret nor its token to a log', async () => {
      const written: string[] = [];
      const capture = (stream: NodeJS.WriteStream) =>
        jest.spyOn(stream, 'write').mockImplementation((chunk: string | Uint8Array) => {
          written.push(String(chunk));
          return true;
        });
      const spies = [capture(process.stdout), capture(process.stderr)];
      const consoleSpies = (['log', 'info', 'debug', 'warn', 'error'] as const).map((method) =>
        jest
          .spyOn(console, method)
          .mockImplementation((...args: unknown[]) => void written.push(args.map(String).join(' '))),
      );
      try {
        const record = await serve('http', verboseConfig);
        const { token } = deriveSharedServerKeys(record.secret);
        await post(record, record.path, { authorization: `Bearer ${token}` }, initialize);
        await post(record, record.path, { authorization: 'Bearer wrong' }, initialize);
        await post(record, SHARED_IDENTIFY_PATH, {}, { nonce: createSharedServerNonce() });
        await post(record, SHARED_DRAIN_PATH, { authorization: 'Bearer wrong' }, { version: '9.0.0' });
        await post(record, SHARED_DRAIN_PATH, { authorization: `Bearer ${token}` }, { version: '0.1.0' });
        await post(record, SHARED_DRAIN_PATH, { authorization: `Bearer ${token}` }, { version: '9.0.0' });
        await (servers.pop() as SharedServerHandle).close();

        const logDirectory = path.join(home, 'logs');
        const files = fs.existsSync(logDirectory) ? fs.readdirSync(logDirectory) : [];
        const everything = [
          ...written,
          ...files.map((file) => fs.readFileSync(path.join(logDirectory, file), 'utf8')),
        ].join('\n');
        expect(everything.length).toBeGreaterThan(0);
        expect(everything).not.toContain(token);
        expect(everything).not.toContain(record.secret);
      } finally {
        for (const spy of [...spies, ...consoleSpies]) spy.mockRestore();
      }
    });
  });
});
