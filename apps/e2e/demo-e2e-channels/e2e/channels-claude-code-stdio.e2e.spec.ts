/**
 * E2E: the messages Claude Code 2.1.322 sends a channel server it spawned over stdio, replayed from a capture
 * (see scripts/claude-code). It probes with `server/discover` on 2026-07-28, falls back to `initialize` once the
 * probe is declined, and never declares `experimental['claude/channel']`; channel events must reach it anyway,
 * and so must the occurrences of an event with the `channel` option.
 */
import { join } from 'node:path';

import { StdioJsonRpcProcess, type JsonRpcMessage } from '../../demo-e2e-stdio-transport/e2e/helpers/stdio-json-rpc';

const projectPath = join(__dirname, '..');
const CHANNEL_NOTIFICATION = 'notifications/claude/channel';

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

const EMIT_ERROR_EVENT: JsonRpcMessage = {
  jsonrpc: '2.0',
  id: 1,
  method: 'tools/call',
  params: {
    name: 'emit-app-event',
    arguments: { event: 'app:error', payload: { level: 'info', message: 'Disk usage is back to normal' } },
  },
};

const DEPLOY = { version: '1.4.0', status: 'succeeded', env: 'prod' };

/** A `tools/call` of `publish-deploy-event` for one of the demo's deploy events. */
function publishDeployEvent(id: number, eventName: 'deploy.started' | 'deploy.finished'): JsonRpcMessage {
  return {
    jsonrpc: '2.0',
    id,
    method: 'tools/call',
    params: { name: 'publish-deploy-event', arguments: { event: eventName, ...DEPLOY } },
  };
}

/** The id of the occurrence a `publish-deploy-event` call published. */
function publishedEventId(reply: JsonRpcMessage): string {
  const structured = reply.result?.['structuredContent'] as { eventId: string };
  return structured.eventId;
}

/** Whether a message is the channel notification of an occurrence of `eventName`. */
function isChannelEvent(message: JsonRpcMessage, eventName: string): boolean {
  const meta = message.params?.['meta'] as Record<string, string> | undefined;
  return message.method === CHANNEL_NOTIFICATION && meta?.['event'] === eventName;
}

describe('Channels in a Claude Code stdio session', () => {
  let server: StdioJsonRpcProcess;

  beforeAll(() => {
    server = StdioJsonRpcProcess.start(join(projectPath, 'src/stdio-entrypoint.ts'), projectPath);
  });

  afterAll(async () => {
    await server.stop();
  });

  it('declines the 2026-07-28 probe, then sends a channel event to the session that declared no capability', async () => {
    const probe = await server.request(DISCOVER_PROBE, 60_000);
    expect(probe.result).toBeUndefined();
    expect(probe.error).toEqual({
      code: -32022,
      message: 'Unsupported protocol version: 2026-07-28',
      data: { supported: ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'], requested: '2026-07-28' },
    });

    const initialized = await server.request(INITIALIZE);
    expect(initialized.result?.['protocolVersion']).toBe('2025-11-25');
    expect(initialized.result?.['capabilities']).toMatchObject({ experimental: { 'claude/channel': {} } });
    server.send({ jsonrpc: '2.0', method: 'notifications/initialized' });

    const emitted = await server.request(EMIT_ERROR_EVENT);
    expect(emitted.result?.['structuredContent']).toEqual({ emitted: true, event: 'app:error' });

    const notification = await server.waitFor((message) => message.method === CHANNEL_NOTIFICATION);
    expect(notification).toEqual({
      jsonrpc: '2.0',
      method: CHANNEL_NOTIFICATION,
      params: { content: '[INFO] Disk usage is back to normal', meta: { severity: 'info', source: 'error-alerts' } },
    });
    for (const line of server.stdoutLines) expect(JSON.parse(line)).toHaveProperty('jsonrpc', '2.0');
  }, 120_000);

  it('says in its instructions that a tag with event and event_id attributes is a published event', async () => {
    const initialized = await server.waitFor((message) => message.id === INITIALIZE.id && !!message.result);

    expect(initialized.result?.['instructions']).toContain(
      'Events arrive as <channel> tags. Reply with the channel-reply tool. ' +
        'A tag with event and event_id attributes is an event this server published: ' +
        'event is its name, event_id its id.',
    );
  });

  it('sends an occurrence of an event with channel: true as its payload in JSON, with event and event_id', async () => {
    const eventId = publishedEventId(await server.request(publishDeployEvent(2, 'deploy.started')));
    expect(eventId).toMatch(/^evt_/);

    const notification = await server.waitFor((message) => isChannelEvent(message, 'deploy.started'));

    expect(notification).toEqual({
      jsonrpc: '2.0',
      method: CHANNEL_NOTIFICATION,
      params: {
        content: '{"version":"1.4.0","status":"succeeded","env":"prod"}',
        meta: { event: 'deploy.started', event_id: eventId },
      },
    });
  });

  it('sends the message the content and meta functions of an event shape, with keys Claude Code keeps', async () => {
    const eventId = publishedEventId(await server.request(publishDeployEvent(3, 'deploy.finished')));

    const notification = await server.waitFor((message) => isChannelEvent(message, 'deploy.finished'));

    expect(notification).toEqual({
      jsonrpc: '2.0',
      method: CHANNEL_NOTIFICATION,
      params: {
        content: 'Deploy succeeded: 1.4.0',
        meta: { env: 'prod', deploy_version: '1.4.0', event: 'deploy.finished', event_id: eventId },
      },
    });
    for (const line of server.stdoutLines) expect(JSON.parse(line)).toHaveProperty('jsonrpc', '2.0');
  });
});
