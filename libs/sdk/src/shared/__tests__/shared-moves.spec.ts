/**
 * A session that moves to another key (#1349): a function `key` is read again each time `rereadKey.file` changes, and a
 * new key moves the session to that key's server, which it starts only from an entry its own config names.
 */
import 'reflect-metadata';

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { PassThrough } from 'node:stream';

import { randomBytes } from '@frontmcp/utils';

import { startIdentityStub, type IdentityStub } from '../../__test-utils__/helpers/shared-server-stub';
import { callTool, clientOf, initialize, structuredOf } from '../../__test-utils__/helpers/shared-session-client';
import { App, LogLevel, Tool, ToolContext, type FrontMcpConfigInput } from '../../common';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';
import {
  attachSharedSession,
  mayStartServerOf,
  type AttachSharedSessionOptions,
  type SharedSession,
} from '../shared-attach';
import { bootEmbeddedServer } from '../shared-embedded';
import { prepareSharedDirectory, sharedServerFiles, writeServerRecord } from '../shared-files';
import { serveShared, type SharedServerHandle } from '../shared-serve';
import { parseSharedServerOptions, type ResolvedSharedServerOptions } from '../shared-server.options';

let openGate: () => void = () => undefined;
let gate: Promise<void> = Promise.resolve();

/** An app whose `whoami` tool names the server that answers, and whose `slow` tool waits for the gate first. */
function labelledApp(label: string) {
  @Tool({ name: 'whoami', inputSchema: {} })
  class WhoAmITool extends ToolContext {
    async execute() {
      return { server: label };
    }
  }
  @Tool({ name: 'slow', inputSchema: {} })
  class SlowTool extends ToolContext {
    async execute() {
      await gate;
      return { server: label };
    }
  }
  @App({ id: label, name: label, tools: [WhoAmITool, SlowTool] })
  class LabelledApp {}
  return LabelledApp;
}

function configOf(label: string): FrontMcpConfigInput {
  return {
    info: { name: 'moves-spec', version: '1.0.0' },
    apps: [labelledApp(label)],
    logging: { level: LogLevel.Off, enableConsole: false },
  };
}

const create = (parsed: ConstructorParameters<typeof FrontMcpInstance>[0]) => new FrontMcpInstance(parsed);
const posixOnly = process.platform === 'win32' ? describe.skip : describe;

jest.setTimeout(30_000);

posixOnly('a shared session that moves to another key', () => {
  let home: string;
  let previousHome: string | undefined;
  let keyFile: string;
  let servers: SharedServerHandle[];
  let sessions: SharedSession[];
  let stubs: IdentityStub[];
  let stderr: jest.SpyInstance;
  let nextKey: () => string;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'sdk-moves-'));
    previousHome = process.env['FRONTMCP_HOME'];
    process.env['FRONTMCP_HOME'] = home;
    keyFile = path.join(home, 'active-key');
    fs.writeFileSync(keyFile, 'one');
    nextKey = () => fs.readFileSync(keyFile, 'utf8').trim();
    servers = [];
    sessions = [];
    stubs = [];
    gate = Promise.resolve();
    stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(async () => {
    openGate();
    for (const session of sessions) await session.stop();
    for (const server of servers) await server.close();
    for (const stub of stubs) await stub.close();
    stderr.mockRestore();
    if (previousHome === undefined) delete process.env['FRONTMCP_HOME'];
    else process.env['FRONTMCP_HOME'] = previousHome;
    fs.rmSync(home, { recursive: true, force: true });
  });

  function stderrLines(): string[] {
    return stderr.mock.calls.map(([line]) => String(line));
  }

  function optionsFor(transport: 'unix' | 'http', key: string): ResolvedSharedServerOptions {
    return parseSharedServerOptions({ key, transport, idleTimeoutMs: false, checkout: false });
  }

  async function serve(transport: 'unix' | 'http', key: string, label = key): Promise<void> {
    servers.push(
      await serveShared({ config: configOf(label), options: optionsFor(transport, key), create, exit: jest.fn() }),
    );
  }

  /** A session of key `one` whose key is read from the key file again each time it changes. */
  function attach(transport: 'unix' | 'http', overrides: Partial<AttachSharedSessionOptions> = {}) {
    const input = new PassThrough();
    const output = new PassThrough();
    const session = attachSharedSession({
      ...optionsFor(transport, 'one'),
      keySource: () => nextKey(),
      rereadKey: { file: keyFile, intervalMs: 50 },
      name: 'moves-spec',
      version: '1.0.0',
      input,
      output,
      bootEmbedded: (key) => bootEmbeddedServer(configOf(`embedded-${key}`), optionsFor(transport, key), create),
      spawnServer: () => {
        throw new Error('no server should be started');
      },
      attachBudgetMs: 500,
      ...overrides,
    });
    sessions.push(session);
    return clientOf(input, output);
  }

  async function whoami(client: ReturnType<typeof clientOf>, id: number): Promise<unknown> {
    const answer = await client.request(callTool(id, 'whoami'));
    expect(answer.error).toBeUndefined();
    return structuredOf(answer)['server'];
  }

  /** Point the key file at `key`: its size or time changes, which the session's watch sees. */
  function writeKey(key: string): void {
    fs.writeFileSync(keyFile, `${key}\n`);
  }

  async function waitFor(condition: () => boolean, what: string, timeoutMs = 15_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!condition()) {
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  describe.each(['unix', 'http'] as const)('over %s', (transport) => {
    it("moves to the new key's server when the key file changes, and tells the client the lists changed", async () => {
      await serve(transport, 'one');
      await serve(transport, 'two');
      const client = attach(transport);
      expect((await client.request(initialize)).result).toBeDefined();
      client.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
      expect(await whoami(client, 2)).toBe('one');

      writeKey('two');
      await waitFor(() => stderrLines().some((line) => line.includes('moved to the shared server "two"')), 'the move');

      expect(await whoami(client, 3)).toBe('two');
      expect(client.received.some(({ method }) => method === 'notifications/tools/list_changed')).toBe(true);
      expect(client.received.filter(({ id }) => id === 1)).toHaveLength(1);
    });
  });

  it('finishes the requests in flight on the server it moves from', async () => {
    await serve('unix', 'one');
    await serve('unix', 'two');
    const client = attach('unix');
    await client.request(initialize);
    gate = new Promise((resolve) => (openGate = resolve));
    const slow = client.request(callTool(2, 'slow'));

    writeKey('two');
    await waitFor(() => stderrLines().some((line) => line.includes('moved to the shared server "two"')), 'the move');
    expect(await whoami(client, 3)).toBe('two');
    openGate();

    expect(structuredOf(await slow)).toEqual({ server: 'one' });
  });

  it('stays where it is when no server runs for the new key and its config names no entry to start one', async () => {
    await serve('unix', 'one');
    const spawnServer = jest.fn(() => ({ exitReason: undefined }));
    const client = attach('unix', { spawnServer });
    await client.request(initialize);

    writeKey('two');
    await waitFor(
      () => stderrLines().some((line) => line.includes('staying on the shared server "one"')),
      'the refusal',
    );

    expect(spawnServer).not.toHaveBeenCalled();
    expect(await whoami(client, 2)).toBe('one');
    expect(stderrLines().find((line) => line.includes('staying on'))).toContain(
      'the server of key "two" can\'t be reached (no server proved its identity within 500 ms, and the session may not start one)',
    );
  });

  it("starts the new key's server from the entry its config names for that key", async () => {
    await serve('unix', 'one');
    const spawned: string[] = [];
    const client = attach('unix', {
      entries: { two: '/srv/checkout-two/dist/shared.js' },
      attachBudgetMs: 10_000,
      spawnServer: (holder, key) => {
        spawned.push(key);
        void serveShared({
          config: configOf(key),
          options: optionsFor('unix', key),
          create,
          exit: jest.fn(),
          startLockHolder: holder,
        }).then((server) => servers.push(server));
        return { exitReason: undefined };
      },
    });
    await client.request(initialize);

    writeKey('two');
    await waitFor(() => stderrLines().some((line) => line.includes('moved to the shared server "two"')), 'the move');

    expect(spawned).toEqual(['two']);
    expect(await whoami(client, 2)).toBe('two');
  });

  it('keeps its key, and says why, when the key function throws or answers no key', async () => {
    await serve('unix', 'one');
    await serve('unix', 'two');
    const client = attach('unix');
    await client.request(initialize);

    nextKey = () => {
      throw new Error('no checkout');
    };
    writeKey('two');
    await waitFor(
      () => stderrLines().some((line) => line.includes('the key function failed (no checkout)')),
      'a warning',
    );
    nextKey = () => 'Not A Key';
    writeKey('three');
    await waitFor(() => stderrLines().some((line) => line.includes('answered "Not A Key"')), 'a second warning');

    expect(await whoami(client, 2)).toBe('one');
    expect(stderrLines().filter((line) => line.includes('keeping the shared server key "one"'))).toHaveLength(2);
  });

  it("never moves to a process on the new key that does not prove it is that key's server", async () => {
    await serve('http', 'one');
    const secret = Buffer.from(randomBytes(32)).toString('base64url');
    const stub = await startIdentityStub({
      secret: Buffer.from(randomBytes(32)).toString('base64url'),
      behavior: 'prove',
    });
    stubs.push(stub);
    const files = sharedServerFiles('two');
    await prepareSharedDirectory(files);
    await writeServerRecord(files, {
      name: 'moves-spec',
      transport: 'http',
      port: stub.port,
      path: '/',
      pid: 1,
      secret,
    });
    const client = attach('http');
    await client.request(initialize);

    writeKey('two');
    await waitFor(
      () => stderrLines().some((line) => line.includes('staying on the shared server "one"')),
      'the refusal',
    );

    expect(await whoami(client, 2)).toBe('one');
    expect(stub.requests.filter(({ headers }) => headers['authorization'] !== undefined)).toEqual([]);
  });

  it('may start only its first key, with its own entry, and the keys its entries name', () => {
    const options = { key: 'one', entries: { two: '/srv/two.js' } };
    expect(mayStartServerOf(options, 'one')).toBe(true);
    expect(mayStartServerOf(options, 'two')).toBe(true);
    expect(mayStartServerOf(options, 'three')).toBe(false);
    expect(mayStartServerOf(options, 'constructor')).toBe(false);
  });
});
