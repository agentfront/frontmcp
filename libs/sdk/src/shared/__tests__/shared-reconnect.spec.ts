/**
 * A stdio session outlives the server it is attached to: when that server goes away, or a session of a newer version
 * replaces it, the session reaches the next one, replays the client's `initialize` and says the lists changed. It
 * never attaches to an older server, and runs the server in its own process when it can't attach in its budget.
 */
import 'reflect-metadata';

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { PassThrough } from 'node:stream';

import {
  callTool,
  clientOf,
  initialize,
  structuredOf,
  type Frame,
} from '../../__test-utils__/helpers/shared-session-client';
import { App, FlowHooksOf, LogLevel, Tool, ToolContext, type FrontMcpConfigInput } from '../../common';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';
import { attachSharedSession, type AttachSharedSessionOptions, type SharedSession } from '../shared-attach';
import { runEmbeddedServer } from '../shared-embedded';
import { readServerRecord, sharedServerFiles } from '../shared-files';
import { serveShared, type SharedServerHandle } from '../shared-serve';
import { parseSharedServerOptions } from '../shared-server.options';

const { Will } = FlowHooksOf('http:request');

/** An app whose `whoami` tool names the server that answers. */
function labelledApp(label: string) {
  @Tool({ name: 'whoami', inputSchema: {} })
  class WhoAmITool extends ToolContext {
    async execute() {
      return { server: label };
    }
  }
  @App({ id: label, name: label, tools: [WhoAmITool] })
  class LabelledApp {}
  return LabelledApp;
}

function configOf(label: string, version = '1.0.0', extra: Partial<FrontMcpConfigInput> = {}): FrontMcpConfigInput {
  return {
    info: { name: 'reconnect-spec', version },
    apps: [labelledApp(label)],
    logging: { level: LogLevel.Off, enableConsole: false },
    ...extra,
  };
}

const create = (parsed: ConstructorParameters<typeof FrontMcpInstance>[0]) => new FrontMcpInstance(parsed);

const clientCapabilities = { roots: { listChanged: true }, sampling: {} };
const initializeWithCapabilities: Frame = {
  ...initialize,
  params: { ...initialize.params, capabilities: clientCapabilities },
};

async function waitUntil(condition: () => boolean, what: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

const posixOnly = process.platform === 'win32' ? describe.skip : describe;

posixOnly('a shared session across servers', () => {
  let home: string;
  let previousHome: string | undefined;
  let servers: SharedServerHandle[];
  let sessions: SharedSession[];
  let stderr: jest.SpyInstance;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'sdk-shared-reconnect-'));
    previousHome = process.env['FRONTMCP_HOME'];
    process.env['FRONTMCP_HOME'] = home;
    servers = [];
    sessions = [];
    stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(async () => {
    for (const session of sessions) await session.stop();
    for (const server of servers) await server.close();
    stderr.mockRestore();
    if (previousHome === undefined) delete process.env['FRONTMCP_HOME'];
    else process.env['FRONTMCP_HOME'] = previousHome;
    fs.rmSync(home, { recursive: true, force: true });
  });

  function stderrLines(): string[] {
    return stderr.mock.calls.map(([line]) => String(line));
  }

  async function serve(transport: 'unix' | 'http', config: FrontMcpConfigInput, exit = jest.fn(), holder?: string) {
    const options = parseSharedServerOptions({ key: 'spec', transport, idleTimeoutMs: false, checkout: false });
    const server = await serveShared({ config, options, create, exit, startLockHolder: holder });
    servers.push(server);
    return server;
  }

  function attach(
    transport: 'unix' | 'http',
    overrides: Partial<AttachSharedSessionOptions> & { serves?: FrontMcpConfigInput } = {},
  ) {
    const { serves, ...rest } = overrides;
    const input = new PassThrough();
    const output = new PassThrough();
    const options = parseSharedServerOptions({ key: 'spec', transport, idleTimeoutMs: false, checkout: false });
    const session = attachSharedSession({
      ...options,
      version: '1.0.0',
      input,
      output,
      embed: () => runEmbeddedServer(configOf('embedded'), 'spec', create),
      spawnServer: (holder) => {
        if (!serves) throw new Error('no server should be started');
        void serve(transport, serves, jest.fn(), holder);
        return { exitReason: undefined };
      },
      ...rest,
    });
    sessions.push(session);
    return { session, client: clientOf(input, output) };
  }

  async function whoami(client: ReturnType<typeof clientOf>, id: number): Promise<unknown> {
    const answer = await client.request(callTool(id, 'whoami'));
    expect(answer.error).toBeUndefined();
    return structuredOf(answer)['server'];
  }

  describe.each(['unix', 'http'] as const)('over %s', (transport) => {
    it('reaches the next server when its server goes away, replays initialize, then says the lists changed', async () => {
      const first = await serve(transport, configOf('first'));
      const sent = jest.spyOn(globalThis, 'fetch');
      const { client } = attach(transport, { serves: configOf('second') });
      try {
        expect((await client.request(initializeWithCapabilities)).result).toBeDefined();
        client.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
        expect(await whoami(client, 2)).toBe('first');

        await first.close();
        servers.splice(servers.indexOf(first), 1);

        expect(await whoami(client, 3)).toBe('second');
        const changed = client.received.findIndex(({ method }) => method === 'notifications/tools/list_changed');
        const answered = client.received.findIndex(({ id }) => id === 3);
        expect(changed).toBeGreaterThan(-1);
        expect(changed).toBeLessThan(answered);
        expect(client.received.filter(({ id }) => id === 1)).toHaveLength(1);
        if (transport === 'http') {
          const initializes = sent.mock.calls
            .map(([, init]) => (typeof init?.body === 'string' ? (JSON.parse(init.body) as Frame) : undefined))
            .filter((frame) => frame?.method === 'initialize');
          expect(initializes).toHaveLength(2);
          expect(initializes[1]?.params).toEqual(initializeWithCapabilities.params);
          expect(String(initializes[1]?.id)).toMatch(/reinitialize/);
        }
      } finally {
        sent.mockRestore();
      }
    });

    it('is moved, with its client none the wiser, to the server a session of a newer version replaces its own with', async () => {
      const olderExit = jest.fn();
      await serve(transport, configOf('older', '1.0.0'), olderExit);
      const { client: older } = attach(transport);
      expect((await older.request(initializeWithCapabilities)).result).toBeDefined();
      older.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
      expect(await whoami(older, 2)).toBe('older');

      const { client: newer } = attach(transport, { version: '2.0.0', serves: configOf('newer', '2.0.0') });
      expect((await newer.request(initialize)).result).toBeDefined();
      expect(await whoami(newer, 2)).toBe('newer');
      await waitUntil(() => olderExit.mock.calls.length > 0, 'the older server to exit');
      expect(olderExit).toHaveBeenCalledWith(0);

      expect(await whoami(older, 3)).toBe('newer');
      expect(older.received.some(({ method }) => method === 'notifications/tools/list_changed')).toBe(true);
      expect(await readServerRecord(sharedServerFiles('spec'))).toMatchObject({ pid: process.pid });
    });
  });

  it('attaches to a newer server, which a session of an older version never makes exit', async () => {
    const newerExit = jest.fn();
    await serve('unix', configOf('newer', '2.0.0'), newerExit);
    const { client } = attach('unix', { version: '1.0.0' });

    expect((await client.request(initialize)).result).toBeDefined();
    expect(await whoami(client, 2)).toBe('newer');
    expect(newerExit).not.toHaveBeenCalled();
  });

  it('never attaches to an older server it may not replace: it runs the server itself, announced once', async () => {
    const olderExit = jest.fn();
    await serve('unix', configOf('older', '1.0.0'), olderExit);
    const { client } = attach('unix', { version: '2.0.0', replaceOlder: false });

    expect((await client.request(initialize)).result).toBeDefined();
    expect(await whoami(client, 2)).toBe('embedded');
    expect(await whoami(client, 3)).toBe('embedded');

    expect(olderExit).not.toHaveBeenCalled();
    expect(fs.existsSync(sharedServerFiles('spec').recordFile)).toBe(true);
    expect(stderrLines().filter((line) => line.includes('in this process'))).toEqual([
      '[frontmcp shared] warn running the shared server "spec" in this process: the shared server runs version ' +
        "1.0.0, older than this session's 2.0.0, and replaceOlder is off\n",
    ]);
  });

  it('runs the server itself once its attach budget runs out, announced once', async () => {
    const started = Date.now();
    const { session, client } = attach('http', {
      attachBudgetMs: 300,
      spawnServer: () => ({ exitReason: undefined }),
    });

    expect((await client.request(initialize)).result).toBeDefined();
    await session.attached;
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(await whoami(client, 2)).toBe('embedded');
    expect(stderrLines().filter((line) => line.includes('in this process'))).toEqual([
      '[frontmcp shared] warn running the shared server "spec" in this process: The shared server "spec" did not ' +
        'start: no server proved its identity within 300 ms\n',
    ]);
  });

  it('runs the same flows, hooks included, when it runs the server itself', async () => {
    const seen: string[] = [];
    class RequestWatch {
      @Will('traceRequest')
      watch(run: { rawInput: { request?: { body?: { method?: string } } } }): void {
        seen.push(String(run.rawInput.request?.body?.method));
      }
    }
    const watched = configOf('embedded', '1.0.0', {
      providers: [{ name: 'request-watch', provide: RequestWatch, useValue: new RequestWatch() }],
    });
    const { client } = attach('unix', {
      attachBudgetMs: 200,
      spawnServer: () => ({ exitReason: undefined }),
      embed: () => runEmbeddedServer(watched, 'spec', create),
    });

    expect((await client.request(initialize)).result).toBeDefined();
    expect(await whoami(client, 2)).toBe('embedded');
    expect(seen).toEqual(expect.arrayContaining(['initialize', 'tools/call']));
  });
});
