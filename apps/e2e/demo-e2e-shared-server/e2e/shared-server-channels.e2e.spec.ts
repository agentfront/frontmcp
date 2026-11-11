/**
 * E2E: a Claude Code channel reaches the stdio sessions of a shared local server. Each session replays the messages
 * Claude Code 2.1.322 sends a stdio server: a `server/discover` probe on 2026-07-28, then, once that is declined,
 * `initialize` with no `experimental['claude/channel']`. The server pushes a channel event to every session, and a
 * session that moved to a newer server gets the events of that one.
 */
import type { JsonRpcMessage, StdioJsonRpcProcess } from '../../demo-e2e-stdio-transport/e2e/helpers/stdio-json-rpc';
import { ATTACH_TIMEOUT_MS, callServerPid, running, SharedSessions, waitUntil } from './helpers/shared-sessions';

const CHANNEL_NOTIFICATION = 'notifications/claude/channel';
const LIST_CHANGED = 'notifications/tools/list_changed';
const EXIT_TIMEOUT_MS = 30_000;

const CLIENT_INFO = { name: 'claude-code', title: 'Claude Code', version: '2.1.322' };
const CLIENT_CAPABILITIES = { roots: { listChanged: true }, elicitation: { form: {}, url: {} } };

const DISCOVER_PROBE: JsonRpcMessage = {
  jsonrpc: '2.0',
  id: 'server-discover-probe-1',
  method: 'server/discover',
  params: {
    _meta: {
      'io.modelcontextprotocol/protocolVersion': '2026-07-28',
      'io.modelcontextprotocol/clientInfo': CLIENT_INFO,
      'io.modelcontextprotocol/clientCapabilities': {
        ...CLIENT_CAPABILITIES,
        extensions: { 'io.modelcontextprotocol/tasks': {} },
      },
    },
  },
};

const INITIALIZE: JsonRpcMessage = {
  jsonrpc: '2.0',
  id: 0,
  method: 'initialize',
  params: { protocolVersion: '2025-11-25', capabilities: CLIENT_CAPABILITIES, clientInfo: CLIENT_INFO },
};

/** Connect as Claude Code does: the probe, which the session must decline, then `initialize` and `initialized`. */
async function connectAsClaudeCode(session: StdioJsonRpcProcess): Promise<void> {
  const probe = await session.request(DISCOVER_PROBE, ATTACH_TIMEOUT_MS);
  expect(probe.result).toBeUndefined();
  expect(probe.error).toEqual({
    code: -32022,
    message: 'Unsupported protocol version: 2026-07-28',
    data: { supported: ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'], requested: '2026-07-28' },
  });

  const initialized = await session.request(INITIALIZE, ATTACH_TIMEOUT_MS);
  expect(initialized.result?.['protocolVersion']).toBe('2025-11-25');
  expect(initialized.result?.['capabilities']).toMatchObject({ experimental: { 'claude/channel': {} } });
  session.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
}

/** Call the tool that sends a `build-alerts` channel event to every session of the server. */
async function announceBuild(session: StdioJsonRpcProcess, id: number, build: string): Promise<void> {
  const answer = await session.request(
    { jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'announce_build', arguments: { build } } },
    ATTACH_TIMEOUT_MS,
  );
  expect(answer.result?.['structuredContent']).toEqual({ announced: build });
}

/** The channel notification of one build, as the server with pid `server` sends it. */
function buildEvent(build: string, server: number): JsonRpcMessage {
  return {
    jsonrpc: '2.0',
    method: CHANNEL_NOTIFICATION,
    params: { content: `Build ${build} finished on server ${server}`, meta: { build, source: 'build-alerts' } },
  };
}

/** Matches the channel notification of one build. */
function isBuildEvent(build: string) {
  return (message: JsonRpcMessage): boolean => {
    const meta = message.params?.['meta'] as Record<string, string> | undefined;
    return message.method === CHANNEL_NOTIFICATION && meta?.['build'] === build;
  };
}

describe('channels in the sessions of a shared local server', () => {
  let shared: SharedSessions;

  beforeEach(() => {
    shared = new SharedSessions();
  });

  afterEach(async () => {
    await shared.cleanup();
  });

  it.each(['unix', 'http'] as const)(
    'declines the 2026-07-28 probe, then sends a channel event to every session, none of which declared the capability (%s)',
    async (transport) => {
      const first = shared.start(transport);
      const second = shared.start(transport);
      await Promise.all([connectAsClaudeCode(first), connectAsClaudeCode(second)]);
      const server = await callServerPid(first, 1);
      expect(await callServerPid(second, 1)).toBe(server);

      await announceBuild(first, 2, '41');

      expect(await first.waitFor(isBuildEvent('41'))).toEqual(buildEvent('41', server));
      expect(await second.waitFor(isBuildEvent('41'))).toEqual(buildEvent('41', server));
      for (const session of [first, second]) {
        for (const line of session.stdoutLines) expect(JSON.parse(line)).toHaveProperty('jsonrpc', '2.0');
      }
    },
    240_000,
  );

  it('sends a session that moved to a newer server the channel events of that server, and each list change once', async () => {
    const older = shared.start('unix', { SHARED_APP_VERSION: '1.0.0' });
    await connectAsClaudeCode(older);
    const olderServer = await callServerPid(older, 1);
    await announceBuild(older, 2, '41');
    expect(await older.waitFor(isBuildEvent('41'))).toEqual(buildEvent('41', olderServer));

    const newer = shared.start('unix', { SHARED_APP_VERSION: '2.0.0' });
    await connectAsClaudeCode(newer);
    const newerServer = await callServerPid(newer, 1);
    expect(newerServer).not.toBe(olderServer);
    await waitUntil(() => !running(olderServer), EXIT_TIMEOUT_MS, 'the older server to exit');

    expect(await callServerPid(older, 3)).toBe(newerServer);
    await announceBuild(newer, 2, '42');

    expect(await older.waitFor(isBuildEvent('42'))).toEqual(buildEvent('42', newerServer));
    expect(await newer.waitFor(isBuildEvent('42'))).toEqual(buildEvent('42', newerServer));
    const olderLines = older.stdoutLines.map((line) => JSON.parse(line) as JsonRpcMessage);
    expect(olderLines.filter(({ method }) => method === LIST_CHANGED)).toHaveLength(1);
    expect(olderLines.filter(({ method }) => method === CHANNEL_NOTIFICATION)).toHaveLength(2);
  }, 240_000);
});
