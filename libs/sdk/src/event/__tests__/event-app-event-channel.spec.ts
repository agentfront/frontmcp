/**
 * An `app-event` channel named after a declared event is the declaration the event's `channel` option replaces. The
 * server says so at startup, and warns when the event has the option too: a session then gets each occurrence twice.
 */
import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';

import { type DirectMcpServer } from '../../direct/direct.types';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';
import {
  App,
  Channel,
  ChannelContext,
  event,
  LogLevel,
  LogTransport,
  LogTransportInterface,
  type ChannelNotification,
  type FrontMcpConfigInput,
  type LogRecord,
  type ScopeEntry,
} from '../../index';

const deployFinished = event({ name: 'deploy.finished', payloadSchema: { version: z.string() }, channel: true });
const orderCreated = event({ name: 'order.created', payloadSchema: { orderId: z.string() } });

/** Listens to an event that has the channel option. */
@Channel({ name: 'deploys', source: { type: 'app-event', event: 'deploy.finished' } })
class DeploysChannel extends ChannelContext {
  /** Names the deploy of the occurrence. */
  async onEvent(payload: unknown): Promise<ChannelNotification> {
    const { data } = payload as { data: { version: string } };
    return { content: `Deployed ${data.version}` };
  }
}

/** Listens to an event that has no channel option. */
@Channel({ name: 'orders', source: { type: 'app-event', event: 'order.created' } })
class OrdersChannel extends ChannelContext {
  /** Names the order of the occurrence. */
  async onEvent(payload: unknown): Promise<ChannelNotification> {
    const { data } = payload as { data: { orderId: string } };
    return { content: `Order ${data.orderId}` };
  }
}

/** Listens to a name that code emits on the bus by hand. */
@Channel({ name: 'errors', source: { type: 'app-event', event: 'app:error' } })
class ErrorsChannel extends ChannelContext {
  /** Passes the error on as text. */
  async onEvent(payload: unknown): Promise<ChannelNotification> {
    return { content: String(payload) };
  }
}

/** The events and the channels of the shop. */
@App({
  id: 'shop',
  name: 'Shop',
  events: [deployFinished, orderCreated],
  channels: [DeploysChannel, OrdersChannel, ErrorsChannel],
})
class ShopApp {}

const logLines: Array<{ level: string; message: string }> = [];

/** Keeps what the server logs. */
@LogTransport({ name: 'EventChannelOverlapCapture', description: 'Captures log lines' })
class CaptureLogTransport extends LogTransportInterface {
  /** Keeps the level and the message of one log record. */
  log(record: LogRecord): void {
    logLines.push({ level: record.levelName, message: record.message });
  }
}

/** Starts the shop server with its log captured from the info level. */
function startShop(config: Partial<FrontMcpConfigInput> = {}): Promise<DirectMcpServer> {
  return FrontMcpInstance.createDirect({
    info: { name: 'event-app-event-channel', version: '1.0.0' },
    apps: [ShopApp],
    logging: { level: LogLevel.Info, enableConsole: false, transports: [CaptureLogTransport] },
    channels: { enabled: true },
    ...config,
  });
}

/** What the server logged at a level about a channel that listens to an event. */
function logged(level: string): string[] {
  const aboutListening = logLines.filter((line) => line.level === level && line.message.includes('listens to event'));
  return aboutListening.map((line) => line.message);
}

/** Wait for fire-and-forget channel deliveries. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 10; turn++) await new Promise((resolve) => setImmediate(resolve));
}

describe('an app-event channel named after a declared event', () => {
  let server: DirectMcpServer;

  beforeEach(() => {
    logLines.length = 0;
  });

  afterEach(async () => {
    await server.dispose();
  });

  it('warns that sessions get each occurrence twice when the event has the channel option', async () => {
    server = await startShop();

    expect(logged('warn')).toEqual([
      'Channel "deploys" listens to event "deploy.finished", which has the channel option: Claude Code sessions get ' +
        'each occurrence twice, once from the event and once from the channel. Keep one: remove the channel, or ' +
        'the option when the channel does what the option cannot.',
    ]);
  });

  it('says that the channel option replaces the channel when the event has no channel option', async () => {
    server = await startShop();

    expect(logged('info')).toEqual([
      'Channel "orders" listens to event "order.created": the event has no channel option. Setting it can replace ' +
        "this channel, and checks each session's access.",
    ]);
  });

  it('says nothing about a channel whose name is not a declared event', async () => {
    server = await startShop();

    const namedChannels = [...logged('warn'), ...logged('info')].map((message) => message.split('"')[1]);
    expect(namedChannels).toEqual(['deploys', 'orders']);
  });

  it('says nothing when published events stay off the bus', async () => {
    server = await startShop({ events: { bridge: false } });

    expect([...logged('warn'), ...logged('info')]).toEqual([]);
  });

  it('still sends both messages to a session: the warning changes no delivery', async () => {
    server = await startShop();
    const client = await server.connect({ capabilities: { experimental: { 'claude/channel': {} } } });
    const received: Array<{ content: string }> = [];
    client.onNotification((notification) => {
      if (notification.method !== 'notifications/claude/channel') return;
      received.push(notification.params as { content: string });
    });
    const { scope } = server as unknown as { scope: ScopeEntry };

    await scope.events?.publisher?.publish(deployFinished, { version: '1.4.0' });
    await settle();

    expect(received.map((message) => message.content).sort()).toEqual(['Deployed 1.4.0', '{"version":"1.4.0"}']);
    await client.close();
  });
});
