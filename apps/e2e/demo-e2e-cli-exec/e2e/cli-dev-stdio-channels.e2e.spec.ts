/**
 * `frontmcp dev --stdio`, without `--serve`, brings a Claude Code channel to the MCP client. The spec replays the
 * messages Claude Code 2.1.322 sends a stdio server: a `server/discover` probe on 2026-07-28, then, once that is
 * declined, `initialize` with no `experimental['claude/channel']`. The dev server is an HTTP child the CLI restarts
 * on a file change, and the events of the restarted child must arrive too.
 */

import * as path from 'node:path';

import { writeFile } from '@frontmcp/utils';

import {
  createScratchProject,
  helloServerFiles,
  removeScratchProject,
  StdioBridgeClient,
  waitFor,
  type JsonRpcMessage,
} from './helpers/dev-cli';

const TEST_TIMEOUT = 180_000;
const CHANNEL_NOTIFICATION = 'notifications/claude/channel';
const LIST_CHANGED = 'notifications/tools/list_changed';

const CLIENT_INFO = { name: 'claude-code', title: 'Claude Code', version: '2.1.322' };
const CLIENT_CAPABILITIES = { roots: { listChanged: true }, elicitation: { form: {}, url: {} } };
const PROBE_PARAMS = {
  _meta: {
    'io.modelcontextprotocol/protocolVersion': '2026-07-28',
    'io.modelcontextprotocol/clientInfo': CLIENT_INFO,
    'io.modelcontextprotocol/clientCapabilities': {
      ...CLIENT_CAPABILITIES,
      extensions: { 'io.modelcontextprotocol/tasks': {} },
    },
  },
};

/** A channel that names the code that sent the event, and the tool that sends one. */
function buildAlertsSource(codeLabel: string): string {
  return `import { Channel, ChannelContext, Tool, ToolContext, z } from '@frontmcp/sdk';

const BUILD_FINISHED = 'build:finished';

@Channel({ name: 'build-alerts', source: { type: 'app-event', event: BUILD_FINISHED } })
export class BuildAlertChannel extends ChannelContext {
  async onEvent(payload: unknown) {
    const { build } = payload as { build: string };
    return { content: \`Build \${build} finished, says ${codeLabel}\`, meta: { build } };
  }
}

@Tool({ name: 'announce_build', description: 'Send a build-alerts event', inputSchema: { build: z.string() } })
export class AnnounceBuildTool extends ToolContext {
  async execute(input: { build: string }) {
    this.scope.channelEventBus?.emit(BUILD_FINISHED, input);
    return { announced: input.build };
  }
}
`;
}

/** A FrontMCP server with the `build-alerts` channel, the decorator in `src/main.ts`. */
function channelServerFiles(): Record<string, string> {
  return {
    ...helloServerFiles(),
    'src/build-alerts.ts': buildAlertsSource('the first code'),
    'src/main.ts': `import 'reflect-metadata';
import { App, FrontMcp, LogLevel } from '@frontmcp/sdk';
import { AnnounceBuildTool, BuildAlertChannel } from './build-alerts';

@App({ id: 'builds', name: 'Builds', tools: [AnnounceBuildTool], channels: [BuildAlertChannel] })
class BuildsApp {}

@FrontMcp({
  info: { name: 'dev-channels-e2e', version: '1.0.0' },
  apps: [BuildsApp],
  logging: { level: LogLevel.Warn },
  channels: { enabled: true },
})
export default class Server {}
`,
  };
}

/** The channel notifications the client received, in order. */
function channelEvents(client: StdioBridgeClient): JsonRpcMessage[] {
  return client.received.filter((message) => message.method === CHANNEL_NOTIFICATION);
}

/** Call `announce_build`, then wait for the channel event of that build. */
async function announcedEvent(client: StdioBridgeClient, build: string): Promise<JsonRpcMessage> {
  const answer = await client.request('tools/call', { name: 'announce_build', arguments: { build } });
  expect(answer.error).toBeUndefined();
  const isOfBuild = (message: JsonRpcMessage): boolean =>
    (message.params as { meta?: { build?: string } } | undefined)?.meta?.build === build;
  await waitFor(async () => channelEvents(client).some(isOfBuild), 30_000, `the channel event of build ${build}`);
  return channelEvents(client).find(isOfBuild) as JsonRpcMessage;
}

describe('frontmcp dev --stdio: Claude Code channels over the HTTP loopback', () => {
  let projectDir: string;
  let client: StdioBridgeClient | undefined;

  afterEach(async () => {
    const stdoutNoise = client?.stdoutNoise ?? [];
    await client?.close();
    client = undefined;
    if (projectDir) await removeScratchProject(projectDir);
    expect(stdoutNoise).toEqual([]);
  });

  it(
    'declines the 2026-07-28 probe, sends a channel event to the client that declared no capability, and again after a reload',
    async () => {
      projectDir = await createScratchProject('dev-stdio-channels', channelServerFiles());
      client = new StdioBridgeClient(projectDir, []);
      const bridge = client;

      const probe = await bridge.request('server/discover', PROBE_PARAMS);
      expect(probe.result).toBeUndefined();
      expect(probe.error).toEqual({
        code: -32022,
        message: 'Unsupported protocol version: 2026-07-28',
        data: { supported: ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'], requested: '2026-07-28' },
      });

      const initialized = await bridge.request('initialize', {
        protocolVersion: '2025-11-25',
        capabilities: CLIENT_CAPABILITIES,
        clientInfo: CLIENT_INFO,
      });
      expect(initialized.result).toMatchObject({
        protocolVersion: '2025-11-25',
        capabilities: { experimental: { 'claude/channel': {} } },
      });
      bridge.notify('notifications/initialized');

      expect(await announcedEvent(bridge, '41')).toEqual({
        jsonrpc: '2.0',
        method: CHANNEL_NOTIFICATION,
        params: { content: 'Build 41 finished, says the first code', meta: { build: '41', source: 'build-alerts' } },
      });

      await writeFile(path.join(projectDir, 'src', 'build-alerts.ts'), buildAlertsSource('the reloaded code'));
      await waitFor(
        async () => bridge.received.some((message) => message.method === LIST_CHANGED),
        60_000,
        'notifications/tools/list_changed after the reload',
      );

      expect(await announcedEvent(bridge, '42')).toEqual({
        jsonrpc: '2.0',
        method: CHANNEL_NOTIFICATION,
        params: { content: 'Build 42 finished, says the reloaded code', meta: { build: '42', source: 'build-alerts' } },
      });
      expect(channelEvents(bridge)).toHaveLength(2);
      expect(bridge.received.filter((message) => message.method === LIST_CHANGED)).toHaveLength(1);
    },
    TEST_TIMEOUT,
  );
});
