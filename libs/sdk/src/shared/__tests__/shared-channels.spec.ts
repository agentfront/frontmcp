/**
 * A stdio session of a shared local server gets what its server sends on its own, a Claude Code channel event
 * included. Claude Code probes with `server/discover` on MCP 2026-07-28, falls back to `initialize` once the probe
 * is declined, and declares no `experimental['claude/channel']`.
 */
import 'reflect-metadata';

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { PassThrough } from 'node:stream';

import { z } from '@frontmcp/lazy-zod';
import { MCP_20260728_META, PROTOCOL_2026_07_28 } from '@frontmcp/protocol';
import { createHttpUpstream, type JsonRpcFrame } from '@frontmcp/utils';

import {
  callTool,
  clientOf,
  initialize,
  structuredOf,
  type Frame,
} from '../../__test-utils__/helpers/shared-session-client';
import {
  App,
  Channel,
  ChannelContext,
  FlowHooksOf,
  httpRespond,
  LogLevel,
  Tool,
  ToolContext,
  type FrontMcpConfigInput,
} from '../../common';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';
import {
  INITIALIZE_PROTOCOL_VERSIONS,
  PROTOCOL_20260728_ONLY_METHODS,
  unsupportedProtocolVersionError,
} from '../../transport/mcp-20260728';
import { attachSharedSession, type AttachSharedSessionOptions, type SharedSession } from '../shared-attach';
import { runEmbeddedServer } from '../shared-embedded';
import { serveShared, type SharedServerHandle } from '../shared-serve';
import { parseSharedServerOptions } from '../shared-server.options';

const { Will } = FlowHooksOf('http:request');
const CHANNEL_NOTIFICATION = 'notifications/claude/channel';
const LIST_CHANGED = 'notifications/tools/list_changed';
const BUILD_FINISHED = 'build:finished';

/** An app with a channel that says which server sent the event, and the tool that sends one. */
function channelApp(label: string) {
  /** Tells Claude Code sessions that a build finished, and which server says so. */
  @Channel({ name: 'build-alerts', source: { type: 'app-event', event: BUILD_FINISHED } })
  class BuildAlertChannel extends ChannelContext {
    /** The notification of one finished build. */
    async onEvent(payload: unknown) {
      const { build } = payload as { build: string };
      return { content: `Build ${build} finished on ${label}`, meta: { build } };
    }
  }
  /** Emits the app event the `build-alerts` channel listens to. */
  @Tool({ name: 'announce_build', inputSchema: { build: z.string() } })
  class AnnounceBuildTool extends ToolContext {
    /** Emit the event, and answer the build it names. */
    async execute(input: { build: string }) {
      this.scope.channelEventBus?.emit(BUILD_FINISHED, input);
      return { announced: input.build };
    }
  }
  @App({ id: label, name: label, tools: [AnnounceBuildTool], channels: [BuildAlertChannel] })
  class ChannelApp {}
  return ChannelApp;
}

/** The config of a server whose channel names it as `label`. */
function configOf(label: string, extra: Partial<FrontMcpConfigInput> = {}): FrontMcpConfigInput {
  return {
    info: { name: 'channels-spec', version: '1.0.0' },
    apps: [channelApp(label)],
    logging: { level: LogLevel.Off, enableConsole: false },
    channels: { enabled: true },
    ...extra,
  };
}

const create = (parsed: ConstructorParameters<typeof FrontMcpInstance>[0]) => new FrontMcpInstance(parsed);

const CLIENT_INFO = { name: 'claude-code', title: 'Claude Code', version: '2.1.322' };
const CLIENT_CAPABILITIES = { roots: { listChanged: true }, elicitation: { form: {}, url: {} } };

const DISCOVER_PROBE = {
  jsonrpc: '2.0',
  id: 'server-discover-probe-1',
  method: 'server/discover',
  params: {
    _meta: {
      [MCP_20260728_META.protocolVersion]: PROTOCOL_2026_07_28,
      [MCP_20260728_META.clientInfo]: CLIENT_INFO,
      [MCP_20260728_META.clientCapabilities]: CLIENT_CAPABILITIES,
    },
  },
} as unknown as Frame;

const CLAUDE_CODE_INITIALIZE: Frame = {
  ...initialize,
  params: { protocolVersion: '2025-11-25', capabilities: CLIENT_CAPABILITIES, clientInfo: CLIENT_INFO },
};

/** A call of the tool that sends a `build-alerts` event. */
function announceBuild(id: number, build: string): Frame {
  return { ...callTool(id, 'announce_build'), params: { name: 'announce_build', arguments: { build } } };
}

/** The params of the channel notifications a client received, in order. */
function channelEvents(received: Frame[]): Array<Frame['params']> {
  return received.filter(({ method }) => method === CHANNEL_NOTIFICATION).map(({ params }) => params);
}

const posixOnly = process.platform === 'win32' ? describe.skip : describe;

// Each test starts real servers, with their SQLite start lock, and attaches sessions to them.
jest.setTimeout(20_000);

posixOnly('channels in a shared session', () => {
  let home: string;
  let previousHome: string | undefined;
  let servers: SharedServerHandle[];
  let sessions: SharedSession[];
  let stderr: jest.SpyInstance;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'sdk-shared-channels-'));
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

  /** Start a shared server in this process. */
  async function serve(transport: 'unix' | 'http', config: FrontMcpConfigInput, holder?: string) {
    const options = parseSharedServerOptions({ key: 'spec', transport, idleTimeoutMs: false, checkout: false });
    const server = await serveShared({ config, options, create, exit: jest.fn(), startLockHolder: holder });
    servers.push(server);
    return server;
  }

  /** Attach a session to the key's server, starting `serves` when none runs, and speak to it as its client. */
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
      name: 'channels-spec',
      version: '1.0.0',
      input,
      output,
      embed: () => runEmbeddedServer(configOf('embedded'), 'spec', create),
      spawnServer: (holder) => {
        if (!serves) throw new Error('no server should be started');
        void serve(transport, serves, holder);
        return { exitReason: undefined };
      },
      ...rest,
    });
    sessions.push(session);
    return clientOf(input, output);
  }

  /** The handshake Claude Code makes: the probe, which must be declined, then `initialize` with no channel capability. */
  async function connectAsClaudeCode(client: ReturnType<typeof clientOf>): Promise<void> {
    const probe = await client.waitFor(({ id }) => id === DISCOVER_PROBE.id, 'answer to the probe');
    expect(probe.error).toEqual(unsupportedProtocolVersionError(PROTOCOL_2026_07_28, INITIALIZE_PROTOCOL_VERSIONS));
    const initialized = await client.request(CLAUDE_CODE_INITIALIZE);
    expect(initialized.result?.['capabilities']).toMatchObject({ experimental: { 'claude/channel': {} } });
    client.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  }

  describe.each(['unix', 'http'] as const)('over %s', (transport) => {
    it('declines the 2026-07-28 probe, then sends a channel event to the client that declared no capability', async () => {
      await serve(transport, configOf('first'));
      const client = attach(transport);
      client.send(DISCOVER_PROBE);
      await connectAsClaudeCode(client);

      expect(structuredOf(await client.request(announceBuild(2, '41')))).toEqual({ announced: '41' });

      const event = await client.waitFor(({ method }) => method === CHANNEL_NOTIFICATION, 'channel event');
      expect(event).toEqual({
        jsonrpc: '2.0',
        method: CHANNEL_NOTIFICATION,
        params: { content: 'Build 41 finished on first', meta: { build: '41', source: 'build-alerts' } },
      });
    });

    it('gets the channel events of the next server once its server went away, and each list change once', async () => {
      const first = await serve(transport, configOf('first'));
      const client = attach(transport, { serves: configOf('second') });
      client.send(DISCOVER_PROBE);
      await connectAsClaudeCode(client);
      await client.request(announceBuild(2, '41'));
      await client.waitFor(({ method }) => method === CHANNEL_NOTIFICATION, 'channel event of the first server');

      await first.close();
      servers.splice(servers.indexOf(first), 1);
      await client.request(announceBuild(3, '42'));
      await client.waitFor(({ params }) => params?.['content'] === 'Build 42 finished on second', 'second event');

      expect(channelEvents(client.received).map((params) => params?.['content'])).toEqual([
        'Build 41 finished on first',
        'Build 42 finished on second',
      ]);
      expect(client.received.filter(({ method }) => method === LIST_CHANGED)).toHaveLength(1);
    });
  });

  it('gets each channel event once after it lost its server and reached it again', async () => {
    /** Refuses one request with 401, as a server that no longer knows the session's token does. */
    class ForgottenToken {
      refusesNext = false;

      /** Answer 401 once, when asked to. */
      @Will('router')
      refuseOnce(run: { respond(output: ReturnType<typeof httpRespond.json>): void }): void {
        if (!this.refusesNext) return;
        this.refusesNext = false;
        run.respond(httpRespond.json({ error: 'unauthorized' }, { status: 401 }));
      }
    }
    const forgotten = new ForgottenToken();
    const providers = [{ name: 'forgotten-token', provide: ForgottenToken, useValue: forgotten }];
    await serve('unix', configOf('first', { providers }));
    const client = attach('unix');
    client.send(DISCOVER_PROBE);
    await connectAsClaudeCode(client);
    await client.request(announceBuild(2, '41'));
    await client.waitFor(({ method }) => method === CHANNEL_NOTIFICATION, 'channel event');

    forgotten.refusesNext = true;
    await client.request(announceBuild(3, '42'));
    await client.request(announceBuild(4, '43'));
    await client.waitFor(({ params }) => params?.['content'] === 'Build 43 finished on first', 'last event');

    expect(stderr.mock.calls.map(([line]) => String(line))).toContainEqual(
      expect.stringContaining('reaching the next shared server'),
    );
    expect(channelEvents(client.received).map((params) => params?.['content'])).toEqual([
      'Build 41 finished on first',
      'Build 42 finished on first',
      'Build 43 finished on first',
    ]);
  });

  it('declines the probe, but relays no channel event, when it runs the server itself: that server offers no stream', async () => {
    const client = attach('unix', { attachBudgetMs: 200, spawnServer: () => ({ exitReason: undefined }) });
    client.send(DISCOVER_PROBE);
    await connectAsClaudeCode(client);

    expect(structuredOf(await client.request(announceBuild(2, '41')))).toEqual({ announced: '41' });
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(channelEvents(client.received)).toEqual([]);
  });
});

describe('the 2026-07-28 constants of the stdio bridge', () => {
  const supportedVersions = [PROTOCOL_2026_07_28, ...INITIALIZE_PROTOCOL_VERSIONS];
  const channelServer: typeof fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as JsonRpcFrame;
    const result = { supportedVersions, capabilities: { experimental: { 'claude/channel': {} } } };
    return Response.json({ jsonrpc: '2.0', id: request.id, result });
  };

  /** What the bridge answers a client frame for a server that pushes channels. */
  async function bridged(frame: JsonRpcFrame): Promise<JsonRpcFrame[]> {
    const frames: JsonRpcFrame[] = [];
    const log = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), reloadEvent: jest.fn() };
    const upstream = createHttpUpstream({
      url: 'http://localhost/',
      fetch: channelServer,
      log: { ...log, path: undefined, close: async () => undefined },
      onFrame: (answer) => void frames.push(answer),
      claudeCodeChannels: true,
    });
    await upstream.send(frame);
    await upstream.close();
    return frames;
  }

  it('declines a request that declares a revision in its _meta with the error the SDK gives over stdio', async () => {
    const params = { _meta: { [MCP_20260728_META.protocolVersion]: PROTOCOL_2026_07_28 } };

    expect(await bridged({ jsonrpc: '2.0', id: 1, method: 'tools/list', params })).toEqual([
      {
        jsonrpc: '2.0',
        id: 1,
        error: unsupportedProtocolVersionError(PROTOCOL_2026_07_28, INITIALIZE_PROTOCOL_VERSIONS),
      },
    ]);
  });

  it.each(PROTOCOL_20260728_ONLY_METHODS)('declines %s, which exists only in 2026-07-28', async (method) => {
    const [answer] = await bridged({ jsonrpc: '2.0', id: 1, method });

    expect(answer.error).toEqual(unsupportedProtocolVersionError(PROTOCOL_2026_07_28, INITIALIZE_PROTOCOL_VERSIONS));
  });
});
