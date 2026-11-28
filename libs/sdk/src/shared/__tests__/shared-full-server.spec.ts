/**
 * A shared local server that hosts more than MCP (#1349): the config's `http.routes` and people auth are served, a page
 * it serves can post back to it, a detached job's runner can run its entry again, and a session may boot a spare while
 * it attaches.
 */
import 'reflect-metadata';

import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { PassThrough } from 'node:stream';

import { LoopbackTokenAuth } from '@frontmcp/auth';

import { callTool, clientOf, initialize, structuredOf } from '../../__test-utils__/helpers/shared-session-client';
import {
  App,
  HttpRoute,
  HttpRouteContext,
  LogLevel,
  Tool,
  ToolContext,
  type FrontMcpConfigInput,
  type FrontMcpConfigType,
  type HttpOutput,
} from '../../common';
import { isEntryServer } from '../../front-mcp/detached-job.flag';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';
import { attachSharedSession, type AttachSharedSessionOptions, type SharedSession } from '../shared-attach';
import { bootEmbeddedServer, type BootedEmbeddedServer } from '../shared-embedded';
import { readServerRecord, sharedServerFiles, type SharedServerRecord } from '../shared-files';
import { serveShared, type SharedServerHandle } from '../shared-serve';
import { parseSharedServerOptions } from '../shared-server.options';

@Tool({ name: 'whoami', inputSchema: {} })
class WhoAmITool extends ToolContext {
  async execute() {
    return { pid: process.pid };
  }
}

/** A sign-in link for the person at the keyboard, as a tool hands one out. */
@Tool({ name: 'sign_in_link', inputSchema: {} })
class SignInLinkTool extends ToolContext {
  async execute() {
    const { code } = this.get(LoopbackTokenAuth).createCode();
    return { loginPath: `/_frontmcp/people/login?code=${code}` };
  }
}

/** A page only a signed-in person sees. */
@HttpRoute({ method: 'GET', path: '/board', auth: 'people' })
class BoardRoute extends HttpRouteContext {
  handle(): HttpOutput {
    return { kind: 'text', status: 200, body: 'the board', contentType: 'text/plain; charset=utf-8' };
  }
}

@App({ id: 'desk', name: 'Desk', tools: [WhoAmITool, SignInLinkTool], routes: [BoardRoute] })
class DeskApp {}

const config: FrontMcpConfigInput = {
  info: { name: 'full-spec', version: '1.0.0' },
  apps: [DeskApp],
  logging: { level: LogLevel.Off, enableConsole: false },
  http: {
    port: 1,
    entryPath: '/mcp',
    auth: { people: { mode: 'loopback-token', store: false } },
    routes: [
      {
        method: 'GET',
        path: '/plain',
        handler: (_request, response) => {
          response.status(200).json({ plain: true });
        },
      },
    ],
  },
};

@App({ id: 'plain', name: 'Plain', tools: [WhoAmITool] })
class PlainApp {}

const plainConfig: FrontMcpConfigInput = { ...config, http: undefined, apps: [PlainApp] };

interface Answer {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

/** A request to the shared server, over its socket or on loopback, as a browser or a CLI sends it. */
function request(
  target: { socketPath: string } | { port: number },
  method: string,
  urlPath: string,
  headers: Record<string, string> = {},
  body?: string,
): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const sent = http.request(
      {
        ...('port' in target ? { host: '127.0.0.1', port: target.port } : target),
        path: urlPath,
        method,
        headers,
        agent: false,
      },
      (response) => {
        let text = '';
        response.on('data', (chunk: Buffer) => (text += chunk.toString()));
        response.on('end', () => resolve({ status: response.statusCode ?? 0, headers: response.headers, body: text }));
      },
    );
    sent.on('error', reject);
    sent.end(body);
  });
}

const posixOnly = process.platform === 'win32' ? describe.skip : describe;

jest.setTimeout(30_000);

posixOnly('a shared local server that hosts more than MCP', () => {
  let home: string;
  let previousHome: string | undefined;
  let servers: SharedServerHandle[];
  let sessions: SharedSession[];
  let created: FrontMcpConfigType[];

  const create = (parsed: FrontMcpConfigType) => {
    created.push(parsed);
    return new FrontMcpInstance(parsed);
  };

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'sdk-full-'));
    previousHome = process.env['FRONTMCP_HOME'];
    process.env['FRONTMCP_HOME'] = home;
    servers = [];
    sessions = [];
    created = [];
    jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(async () => {
    for (const session of sessions) await session.stop();
    for (const server of servers) await server.close();
    jest.restoreAllMocks();
    if (previousHome === undefined) delete process.env['FRONTMCP_HOME'];
    else process.env['FRONTMCP_HOME'] = previousHome;
    fs.rmSync(home, { recursive: true, force: true });
  });

  function options(transport: 'unix' | 'http') {
    return parseSharedServerOptions({ key: 'spec', transport, idleTimeoutMs: false, checkout: false });
  }

  async function serve(transport: 'unix' | 'http', serverConfig = config): Promise<SharedServerRecord> {
    servers.push(await serveShared({ config: serverConfig, options: options(transport), create, exit: jest.fn() }));
    const record = await readServerRecord(sharedServerFiles('spec'));
    if (!record) throw new Error('the shared server wrote no record');
    return record;
  }

  function attach(transport: 'unix' | 'http', overrides: Partial<AttachSharedSessionOptions> = {}) {
    const input = new PassThrough();
    const output = new PassThrough();
    const session = attachSharedSession({
      ...options(transport),
      name: String(config.info.name),
      version: '1.0.0',
      input,
      output,
      bootEmbedded: () => bootEmbeddedServer(config, options(transport), create),
      spawnServer: () => {
        throw new Error('no server should be started');
      },
      ...overrides,
    });
    sessions.push(session);
    return { session, client: clientOf(input, output) };
  }

  describe('serves the routes of its config', () => {
    it.each(['unix', 'http'] as const)(
      'serves http.routes and keeps the MCP endpoint at its entry path (%s)',
      async (transport) => {
        const record = await serve(transport);
        const target =
          transport === 'unix' ? { socketPath: sharedServerFiles('spec').socketPath } : { port: record.port ?? 0 };

        const plain = await request(target, 'GET', '/plain');
        expect({ status: plain.status, body: JSON.parse(plain.body) }).toEqual({ status: 200, body: { plain: true } });
        expect(record.path).toBe('/mcp');
      },
    );

    it('signs a person in with a link a tool hands out, from a page it serves, and shows them its people pages', async () => {
      const record = await serve('http');
      const port = record.port ?? 0;
      const origin = `http://127.0.0.1:${port}`;
      expect((await request({ port }, 'GET', '/board')).status).not.toBe(200);

      const { client } = attach('http');
      expect((await client.request(initialize)).result).toBeDefined();
      const { loginPath } = structuredOf(await client.request(callTool(2, 'sign_in_link'))) as { loginPath: string };

      const page = await request({ port }, 'GET', loginPath);
      expect(page.status).toBe(200);
      const code = /name="code" value="([^"]+)"/.exec(page.body)?.[1] ?? '';
      const login = await request(
        { port },
        'POST',
        '/_frontmcp/people/login',
        { origin, referer: `${origin}${loginPath}`, 'content-type': 'application/x-www-form-urlencoded' },
        new URLSearchParams({ code }).toString(),
      );
      expect(login.status).toBe(200);
      const cookie = String(login.headers['set-cookie']?.[0] ?? '').split(';')[0];
      expect(cookie).toMatch(/^frontmcp_people=/);

      const board = await request({ port }, 'GET', '/board', { cookie });
      expect({ status: board.status, body: board.body }).toEqual({ status: 200, body: 'the board' });
    });

    it('refuses a sign-in posted from a page of another origin', async () => {
      const record = await serve('http');
      const port = record.port ?? 0;
      const login = await request(
        { port },
        'POST',
        '/_frontmcp/people/login',
        { origin: 'https://evil.example', 'content-type': 'application/x-www-form-urlencoded' },
        new URLSearchParams({ code: 'x' }).toString(),
      );
      expect(login.status).toBe(403);
    });
  });

  describe('runs detached jobs', () => {
    it.each(['unix', 'http'] as const)(
      'marks the shared server as the entry a runner runs again (%s)',
      async (transport) => {
        await serve(transport, plainConfig);
        expect(created).toHaveLength(1);
        expect(isEntryServer(created[0])).toBe(true);
      },
    );

    it('marks the server a session runs in its own process too', async () => {
      const booted = await bootEmbeddedServer(plainConfig, options('unix'), create);
      try {
        expect(isEntryServer(created[0])).toBe(true);
      } finally {
        await booted.close();
      }
    });
  });

  describe('a session of its own', () => {
    it('is served per request when its own socket path would be longer than a socket address holds', async () => {
      const long = path.join(home, 'x'.repeat(60));
      fs.mkdirSync(long, { mode: 0o700 });
      process.env['FRONTMCP_HOME'] = long;
      const booted = await bootEmbeddedServer(plainConfig, options('unix'), create);
      try {
        expect(created[0].serve).toBe(false);
        const served = await booted.start();
        expect(served.url).toBe('http://localhost/');
      } finally {
        await booted.close();
      }
    });
  });

  describe('with a spare', () => {
    /** `bootEmbedded`, counting the boots, the starts and the closes of what it boots. */
    function countedBoots() {
      const counts = { boots: 0, starts: 0, closes: 0 };
      const bootEmbedded = async (): Promise<BootedEmbeddedServer> => {
        counts.boots++;
        const booted = await bootEmbeddedServer(plainConfig, options('unix'), create);
        return {
          start: () => {
            counts.starts++;
            return booted.start();
          },
          close: () => {
            counts.closes++;
            return booted.close();
          },
        };
      };
      return { counts, bootEmbedded };
    }

    it('boots one while it attaches, and shuts it down, never started, once it attached', async () => {
      await serve('unix', plainConfig);
      const { counts, bootEmbedded } = countedBoots();
      const { session, client } = attach('unix', { spare: true, bootEmbedded });

      expect((await client.request(initialize)).result).toBeDefined();
      await session.attached;
      expect(structuredOf(await client.request(callTool(2, 'whoami')))).toEqual({ pid: process.pid });
      await waitFor(() => counts.closes === 1);
      expect(counts).toEqual({ boots: 1, starts: 0, closes: 1 });
    });

    it('serves from the spare it booted when it can not attach, without booting another', async () => {
      const { counts, bootEmbedded } = countedBoots();
      const { session, client } = attach('unix', {
        spare: true,
        bootEmbedded,
        attachBudgetMs: 300,
        spawnServer: () => ({ exitReason: undefined }),
      });

      expect((await client.request(initialize)).result).toBeDefined();
      await session.attached;
      expect(structuredOf(await client.request(callTool(2, 'whoami')))).toEqual({ pid: process.pid });
      expect(counts).toEqual({ boots: 1, starts: 1, closes: 0 });
    });

    it('boots none without the option until it falls back', async () => {
      await serve('unix', plainConfig);
      const { counts, bootEmbedded } = countedBoots();
      const { session, client } = attach('unix', { bootEmbedded });

      expect((await client.request(initialize)).result).toBeDefined();
      await session.attached;
      expect(counts).toEqual({ boots: 0, starts: 0, closes: 0 });
    });

    it('shuts the spare down when the session stops while it attaches', async () => {
      const { counts, bootEmbedded } = countedBoots();
      const { session } = attach('unix', {
        spare: true,
        bootEmbedded,
        attachBudgetMs: 2_000,
        spawnServer: () => ({ exitReason: undefined }),
      });
      await waitFor(() => counts.boots === 1);
      await session.stop();
      await waitFor(() => counts.closes === 1);
      // The attach it stopped ends with its budget, and starts nothing
      await session.attached.catch(() => undefined);
      expect(counts).toEqual({ boots: 1, starts: 0, closes: 1 });
    });
  });
});

async function waitFor(condition: () => boolean, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
