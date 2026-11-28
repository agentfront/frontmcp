/**
 * A session that moves to another key (#1349): a function `key` is read again each time `rereadKey.file` changes, and a
 * new key moves the session to that key's server, which it starts only from an entry its own config names. The moves
 * over both transports, and a squatter on the new key, are covered end to end in demo-e2e-shared-server.
 */
import 'reflect-metadata';

import * as os from 'node:os';
import * as path from 'node:path';
import { PassThrough } from 'node:stream';

import { mkdtemp, readFile, rm, writeFile } from '@frontmcp/utils';

import { callTool, clientOf, initialize, structuredOf } from '../../__test-utils__/helpers/shared-session-client';
import { App, LogLevel, Tool, ToolContext, type FrontMcpConfigInput } from '../../common';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';
import {
  attachSharedSession,
  keyFileSignature,
  mayStartServerOf,
  type AttachSharedSessionOptions,
  type SharedSession,
} from '../shared-attach';
import { bootEmbeddedServer } from '../shared-embedded';
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
  let stderr: jest.SpyInstance;
  let nextKey: () => string | Promise<string>;

  beforeEach(async () => {
    home = await mkdtemp(path.join(os.tmpdir(), 'sdk-moves-'));
    previousHome = process.env['FRONTMCP_HOME'];
    process.env['FRONTMCP_HOME'] = home;
    keyFile = path.join(home, 'active-key');
    await writeFile(keyFile, 'one');
    nextKey = async () => (await readFile(keyFile)).trim();
    servers = [];
    sessions = [];
    gate = Promise.resolve();
    stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(async () => {
    openGate();
    for (const session of sessions) await session.stop();
    for (const server of servers) await server.close();
    stderr.mockRestore();
    if (previousHome === undefined) delete process.env['FRONTMCP_HOME'];
    else process.env['FRONTMCP_HOME'] = previousHome;
    await rm(home, { recursive: true, force: true });
  });

  function stderrLines(): string[] {
    return stderr.mock.calls.map(([line]) => String(line));
  }

  function optionsFor(transport: 'unix' | 'http', key: string): ResolvedSharedServerOptions {
    return parseSharedServerOptions({ key, transport, idleTimeoutMs: false, checkout: false });
  }

  async function serve(transport: 'unix' | 'http', key: string, label = key): Promise<SharedServerHandle> {
    const server = await serveShared({
      config: configOf(label),
      options: optionsFor(transport, key),
      create,
      exit: jest.fn(),
    });
    servers.push(server);
    return server;
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
  async function writeKey(key: string): Promise<void> {
    await writeFile(keyFile, `${key}\n`);
  }

  function moved(key: string): () => boolean {
    return () => stderrLines().some((line) => line.includes(`moved to the shared server "${key}"`));
  }

  async function waitFor(condition: () => boolean, what: string, timeoutMs = 15_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!condition()) {
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  it('finishes the requests in flight on the server it moves from', async () => {
    await serve('unix', 'one');
    await serve('unix', 'two');
    const client = attach('unix');
    await client.request(initialize);
    gate = new Promise((resolve) => (openGate = resolve));
    const slow = client.request(callTool(2, 'slow'));

    await writeKey('two');
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

    await writeKey('two');
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

    await writeKey('two');
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
    await writeKey('two');
    await waitFor(
      () => stderrLines().some((line) => line.includes('the key function failed (no checkout)')),
      'a warning',
    );
    nextKey = () => 'Not A Key';
    await writeKey('three');
    await waitFor(() => stderrLines().some((line) => line.includes('answered "Not A Key"')), 'a second warning');

    expect(await whoami(client, 2)).toBe('one');
    expect(stderrLines().filter((line) => line.includes('keeping the shared server key "one"'))).toHaveLength(2);
  });

  it('moves when the key file changed between the first read and the start of its watch', async () => {
    await serve('unix', 'one');
    await serve('unix', 'two');
    const keySignature = await keyFileSignature(keyFile);
    // The first read answered `one`; the file names `two` before the watch starts
    await writeKey('two');
    const client = attach('unix', { keySignature });
    await client.request(initialize);

    await waitFor(moved('two'), 'the move');
    expect(await whoami(client, 2)).toBe('two');
  });

  it('reads the key once more when its watch starts with no signature from before the first read', async () => {
    await serve('unix', 'one');
    await serve('unix', 'two');
    await writeKey('two');
    const client = attach('unix');
    await client.request(initialize);

    await waitFor(moved('two'), 'the move');
    expect(await whoami(client, 2)).toBe('two');
  });

  it('moves back to its first key, and says so, when the server of the key it moved to is gone for good', async () => {
    await serve('unix', 'one');
    const two = await serve('unix', 'two');
    const client = attach('unix');
    await client.request(initialize);
    await writeKey('two');
    await waitFor(moved('two'), 'the move');
    expect(await whoami(client, 2)).toBe('two');

    await two.close();
    servers.splice(servers.indexOf(two), 1);

    expect(await whoami(client, 3)).toBe('one');
    expect(stderrLines().some((line) => line.includes('moving back to the shared server "one"'))).toBe(true);
    expect(stderrLines().some((line) => line.includes('in this process'))).toBe(false);
  });

  it('may start only its first key, with its own entry, and the keys its entries name', () => {
    const options = { key: 'one', entries: { two: '/srv/two.js' } };
    expect(mayStartServerOf(options, 'one')).toBe(true);
    expect(mayStartServerOf(options, 'two')).toBe(true);
    expect(mayStartServerOf(options, 'three')).toBe(false);
    expect(mayStartServerOf(options, 'constructor')).toBe(false);
  });
});
