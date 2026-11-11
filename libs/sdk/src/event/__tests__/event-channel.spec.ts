/**
 * The `channel` option of an event: each published occurrence is also sent, as `notifications/claude/channel`, to the
 * Claude Code sessions whose caller may see it under the event's own rules.
 */
import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';
import { EVENTS_ERROR_CODES, type AuthInfo, type ListEventsResult } from '@frontmcp/protocol';
import { Client } from '@frontmcp/protocol/client';

import { createTestFetchServer } from '../../__test-utils__/helpers/mcp-20260728.helpers';
import { servesClaudeCodeChannels } from '../../channel/channel.utils';
import {
  App,
  event,
  LogLevel,
  LogTransport,
  LogTransportInterface,
  Plugin,
  type EventEntry,
  type EventSubscriber,
  type FlowCtxOf,
  type FrontMcpConfigInput,
  type LogRecord,
} from '../../common';
import { EventForbiddenError } from '../../errors';
import { EventPublishHook } from '../../index';
import { type SessionCaller } from '../../notification/notification.service';
import { type Scope } from '../../scope/scope.instance';
import { composeCallerInstructions } from '../../skill/skill-instructions.helper';
import { buildScopedServerOptions } from '../../transport/build-scoped-server-options';
import { createInMemoryServer } from '../../transport/in-memory-server';
import { eventChannelMessage } from '../event-channel';

const CHANNEL_NOTIFICATION = 'notifications/claude/channel';
const DECLARES_CHANNELS = { experimental: { 'claude/channel': {} } };
const EVENT_HINT = 'A tag with event and event_id attributes is an event this server published';

const deployPayload = { version: z.string(), status: z.string(), env: z.string() };
const deploy = { version: '1.4.0', status: 'succeeded', env: 'prod' };

const deployFinished = event({ name: 'deploy.finished', payloadSchema: deployPayload, channel: true });

const deployDescribed = event({
  name: 'deploy.described',
  payloadSchema: deployPayload,
  channel: {
    content: (payload) => `Deploy ${payload.status}: ${payload.version}`,
    meta: (payload) => ({ env: payload.env, 'deploy-version': payload.version, event: 'not the name' }),
  },
});

const deployLogged = event({ name: 'deploy.logged', payloadSchema: deployPayload });

const deployUntold = event({
  name: 'deploy.untold',
  payloadSchema: deployPayload,
  channel: {
    content: () => {
      throw new Error('no template');
    },
  },
});

const agentNoted = event({
  name: 'agent.noted',
  payloadSchema: deployPayload,
  availableWhen: { surface: ['agent'] },
  channel: true,
});

const deployFiltered = event({
  name: 'deploy.filtered',
  payloadSchema: deployPayload,
  channel: true,
  match: () => false,
  transform: (occurrence) => ({ ...occurrence, data: { ...occurrence.data, status: 'redacted' } }),
});

const auditLogged = event({
  name: 'audit.logged',
  payloadSchema: { action: z.string() },
  authorities: 'admin',
  channel: true,
});

const vaultAuthorize = jest.fn();
const vaultSeenBy = jest.fn();

const vaultOpened = event({
  name: 'vault.opened',
  payloadSchema: { vaultId: z.string() },
  channel: true,
  authorize(args, subscriber) {
    vaultSeenBy(this.authInfo);
    return vaultAuthorize(args, subscriber);
  },
});

let skippedEvent: string | undefined;

/** Skips the channel stage for the event a test names. */
@Plugin({ name: 'quiet-channel' })
class QuietChannelPlugin {
  /** Goes on to the stage, unless the occurrence is of the skipped event. */
  @EventPublishHook.Around('notifyChannelSessions')
  async skipOne(ctx: FlowCtxOf<'events:publish'>, next: () => Promise<unknown>) {
    if (ctx.rawInput.occurrence.name === skippedEvent) return;
    await next();
  }
}

/** The events of a public server: with and without the option, and the ways the option is left out. */
@App({
  id: 'deploys',
  name: 'Deploys',
  events: [deployFinished, deployDescribed, deployLogged, deployUntold, agentNoted, deployFiltered],
})
class DeploysApp {}

/** The events of a server that signs callers in: open, guarded by authorities, and guarded by authorize(). */
@App({ id: 'vaults', name: 'Vaults', events: [deployFinished, auditLogged, vaultOpened] })
class VaultsApp {}

/** An app whose only event has no channel option. */
@App({ id: 'logs', name: 'Logs', events: [deployLogged] })
class LogsApp {}

const logLines: string[] = [];

/** Keeps what the server logs. */
@LogTransport({ name: 'EventChannelCapture', description: 'Captures log lines' })
class CaptureLogTransport extends LogTransportInterface {
  /** Keeps the message of one log record. */
  log(record: LogRecord): void {
    logLines.push(record.message);
  }
}

const capturedLogging = { level: LogLevel.Warn, enableConsole: false, transports: [CaptureLogTransport] };

/** Starts a server and answers its scope. */
async function startScope(config: Partial<FrontMcpConfigInput>): Promise<Scope> {
  const { instance } = await createTestFetchServer({
    info: { name: 'event-channel', version: '1.0.0' },
    apps: [DeploysApp],
    ...config,
  });
  return instance.getScopes()[0] as Scope;
}

interface SessionOptions {
  stdio?: boolean;
  declaresChannels?: boolean;
  /** The caller of the session's latest request, as its transport keeps it. */
  caller?: SessionCaller;
}

/** Registers a session as a transport does, and answers what records the notifications sent to it. */
function connect(scope: Scope, sessionId: string, options: SessionOptions = {}): jest.Mock {
  const notification = jest.fn();
  scope.notifications.registerServer(sessionId, { notification } as never, { stdio: options.stdio });
  if (options.declaresChannels) scope.notifications.setClientCapabilities(sessionId, DECLARES_CHANNELS);
  if (options.caller) scope.notifications.setCaller(sessionId, options.caller);
  return notification;
}

/** The channel messages a session was sent. */
function messagesOf(notification: jest.Mock): unknown[] {
  return notification.mock.calls.map(([sent]) => {
    const { method, params } = sent as { method: string; params: unknown };
    expect(method).toBe(CHANNEL_NOTIFICATION);
    return params;
  });
}

/** The publisher of a scope. */
function publisherOf(scope: Scope) {
  const publisher = scope.events?.publisher;
  if (!publisher) throw new Error('the scope has no publisher');
  return publisher;
}

/** A registered event of a scope. */
function eventOf(scope: Scope, eventName: string): EventEntry {
  const entry = scope.events?.findByName(eventName);
  if (!entry) throw new Error(`event "${eventName}" is not registered`);
  return entry;
}

/** A signed-in caller as a session keeps it; `expiresAt` is when its credentials expire, in epoch seconds. */
function callerNamed(sub: string, roles: string[] = [], expiresAt?: number): SessionCaller {
  return { user: { sub, roles } as never, ...(expiresAt !== undefined && { expiresAt }) };
}

/** A time in epoch seconds, as a JWT `exp`: so many seconds from now, or ago when negative. */
function secondsFromNow(seconds: number): number {
  return Math.floor(Date.now() / 1000) + seconds;
}

/** Waits until a condition holds. */
async function until(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe('eventChannelMessage', () => {
  let scope: Scope;
  const occurrence = { eventId: 'evt_1', timestamp: '2026-11-11T10:00:00.000Z', data: deploy };

  beforeAll(async () => {
    scope = await startScope({});
  });

  afterAll(async () => {
    await scope.dispose();
  });

  it('sends the payload as JSON, with the event name and id as meta, for channel: true', () => {
    const message = eventChannelMessage(eventOf(scope, 'deploy.finished'), { ...occurrence, name: 'deploy.finished' });

    expect(message).toEqual({
      content: '{"version":"1.4.0","status":"succeeded","env":"prod"}',
      meta: { event: 'deploy.finished', event_id: 'evt_1' },
    });
  });

  it('sends what the content function returns, and the result of the meta function with safe keys', () => {
    const message = eventChannelMessage(eventOf(scope, 'deploy.described'), {
      ...occurrence,
      name: 'deploy.described',
    });

    expect(message).toEqual({
      content: 'Deploy succeeded: 1.4.0',
      meta: { env: 'prod', deploy_version: '1.4.0', event: 'deploy.described', event_id: 'evt_1' },
    });
  });

  it('keeps event and event_id the name and the id, whatever the meta function returns under them', () => {
    const { meta } = eventChannelMessage(eventOf(scope, 'deploy.described'), {
      ...occurrence,
      name: 'deploy.described',
    });

    expect(meta['event']).toBe('deploy.described');
  });
});

describe('events:publish to Claude Code sessions', () => {
  describe('on a server in public auth mode, without channels in its config', () => {
    let scope: Scope;
    const sessionIds = ['stdio-session', 'declared-session', 'plain-session'];

    beforeAll(async () => {
      scope = await startScope({ plugins: [QuietChannelPlugin] });
    });

    afterAll(async () => {
      await scope.dispose();
    });

    afterEach(() => {
      for (const sessionId of sessionIds) scope.notifications.unregisterServer(sessionId);
      skippedEvent = undefined;
      jest.restoreAllMocks();
    });

    it('sends the occurrence to a channel capable session, and not to one that is not', async () => {
      const overStdio = connect(scope, 'stdio-session', { stdio: true });
      const declared = connect(scope, 'declared-session', { declaresChannels: true });
      const plain = connect(scope, 'plain-session');

      const { eventId } = await publisherOf(scope).publish(deployFinished, deploy);

      const message = { content: JSON.stringify(deploy), meta: { event: 'deploy.finished', event_id: eventId } };
      expect(messagesOf(overStdio)).toEqual([message]);
      expect(messagesOf(declared)).toEqual([message]);
      expect(plain).not.toHaveBeenCalled();
    });

    it('sends the message the content and meta functions shape', async () => {
      const overStdio = connect(scope, 'stdio-session', { stdio: true });

      const { eventId } = await publisherOf(scope).publish(deployDescribed, deploy);

      expect(messagesOf(overStdio)).toEqual([
        {
          content: 'Deploy succeeded: 1.4.0',
          meta: { env: 'prod', deploy_version: '1.4.0', event: 'deploy.described', event_id: eventId },
        },
      ]);
    });

    it('sends nothing for an event without the channel option', async () => {
      const overStdio = connect(scope, 'stdio-session', { stdio: true });

      await publisherOf(scope).publish(deployLogged, deploy);

      expect(overStdio).not.toHaveBeenCalled();
    });

    it('sends an occurrence published for a subscription to no session', async () => {
      const overStdio = connect(scope, 'stdio-session', { stdio: true });

      await publisherOf(scope).publish(deployFinished, deploy, { subscriptionId: 'sub_0001' });

      expect(overStdio).not.toHaveBeenCalled();
    });

    it('sends an occurrence published for some owners to no anonymous session', async () => {
      const overStdio = connect(scope, 'stdio-session', { stdio: true });

      await publisherOf(scope).publish(deployFinished, deploy, { audience: { sub: 'ada' } });

      expect(overStdio).not.toHaveBeenCalled();
    });

    it('sends nothing for an event that is not offered to MCP clients', async () => {
      const overStdio = connect(scope, 'stdio-session', { stdio: true });

      await publisherOf(scope).publish(agentNoted, deploy);

      expect(overStdio).not.toHaveBeenCalled();
    });

    it('does not run match() or transform(): a session has no subscription arguments', async () => {
      const overStdio = connect(scope, 'stdio-session', { stdio: true });

      await publisherOf(scope).publish(deployFiltered, deploy);

      expect(messagesOf(overStdio)).toEqual([expect.objectContaining({ content: JSON.stringify(deploy) })]);
    });

    it('publishes, and sends nothing, when the content function throws', async () => {
      const overStdio = connect(scope, 'stdio-session', { stdio: true });

      await expect(publisherOf(scope).publish(deployUntold, deploy)).resolves.toMatchObject({ matched: 0 });

      expect(overStdio).not.toHaveBeenCalled();
    });

    it('still sends to the other sessions when one cannot be written to', async () => {
      const broken = connect(scope, 'declared-session', { declaresChannels: true });
      broken.mockImplementation(() => {
        throw new Error('connection closed');
      });
      const overStdio = connect(scope, 'stdio-session', { stdio: true });

      await expect(publisherOf(scope).publish(deployFinished, deploy)).resolves.toMatchObject({ matched: 0 });

      expect(messagesOf(overStdio)).toHaveLength(1);
    });

    it('counts the notifications it sent', async () => {
      connect(scope, 'stdio-session', { stdio: true });
      connect(scope, 'declared-session', { declaresChannels: true });
      connect(scope, 'plain-session');
      const count = jest.spyOn(scope.events?.metrics as { count: () => void }, 'count');

      await publisherOf(scope).publish(deployFinished, deploy);

      expect(count).toHaveBeenCalledWith('notified', 'deploy.finished', 2);
    });

    it('is a stage a hook skips with an Around that does not go on', async () => {
      const overStdio = connect(scope, 'stdio-session', { stdio: true });
      skippedEvent = 'deploy.finished';

      await publisherOf(scope).publish(deployFinished, deploy);

      expect(overStdio).not.toHaveBeenCalled();
    });

    it('shows no trace of the option in events/list', async () => {
      const request = { method: 'events/list' as const };
      const ctx = { authInfo: {}, surface: 'mcp' };

      const listed: ListEventsResult = await scope.runFlowForOutput('events:list', { request, ctx });

      const told = listed.events.find((definition) => definition.name === 'deploy.described');
      const untold = listed.events.find((definition) => definition.name === 'deploy.logged');
      expect(Object.keys(told ?? {}).sort()).toEqual(['delivery', 'inputSchema', 'name', 'payloadSchema']);
      expect(told?.delivery).toEqual(untold?.delivery);
      expect(told?.delivery).toEqual(['poll', 'push']);
      expect(JSON.stringify(listed)).not.toContain('channel');
    });

    it('sends to a public HTTP session, whose anonymous caller has no credentials that expire', async () => {
      const anonymous: SessionCaller = { clientId: 'anon:1', scopes: [], user: { sub: 'anon:1', iss: 'public' } };
      const overHttp = connect(scope, 'declared-session', { declaresChannels: true, caller: anonymous });
      const overStdio = connect(scope, 'stdio-session', { stdio: true });

      await publisherOf(scope).publish(deployFinished, deploy);

      expect(messagesOf(overHttp)).toHaveLength(1);
      expect(messagesOf(overStdio)).toHaveLength(1);
    });

    it('serves Claude Code channels with no @Channel and no channels config', async () => {
      expect(scope.channels).toBeUndefined();
      expect(servesClaudeCodeChannels(scope)).toBe(true);
      expect(buildScopedServerOptions(scope).capabilities.experimental).toEqual({ 'claude/channel': {} });
      expect(await composeCallerInstructions(scope)).toContain(`Events arrive as <channel> tags. ${EVENT_HINT}`);
    });
  });

  describe('on a server that signs callers in', () => {
    let scope: Scope;
    const sessionIds = ['ada-session', 'bob-session', 'anonymous-session', 'stdio-session'];
    const ada = callerNamed('ada', ['admin']);
    const bob = callerNamed('bob', ['member']);

    beforeAll(async () => {
      scope = await startScope({
        apps: [VaultsApp],
        auth: { mode: 'local' } as never,
        authorities: { profiles: { admin: { roles: { any: ['admin'] } } } },
      });
    });

    afterAll(async () => {
      await scope.dispose();
    });

    beforeEach(() => {
      vaultAuthorize.mockReset();
      vaultSeenBy.mockReset();
    });

    afterEach(() => {
      for (const sessionId of sessionIds) scope.notifications.unregisterServer(sessionId);
    });

    it('sends an occurrence with an audience to the session of that caller only', async () => {
      const toAda = connect(scope, 'ada-session', { declaresChannels: true, caller: ada });
      const toBob = connect(scope, 'bob-session', { declaresChannels: true, caller: bob });

      const { eventId } = await publisherOf(scope).publish(deployFinished, deploy, { audience: { sub: 'bob' } });

      expect(toAda).not.toHaveBeenCalled();
      expect(messagesOf(toBob)).toEqual([
        { content: JSON.stringify(deploy), meta: { event: 'deploy.finished', event_id: eventId } },
      ]);
    });

    it('sends an occurrence without an audience to every signed-in session', async () => {
      const toAda = connect(scope, 'ada-session', { declaresChannels: true, caller: ada });
      const toBob = connect(scope, 'bob-session', { declaresChannels: true, caller: bob });

      await publisherOf(scope).publish(deployFinished, deploy);

      expect(messagesOf(toAda)).toHaveLength(1);
      expect(messagesOf(toBob)).toHaveLength(1);
    });

    it('sends nothing to a session whose caller is anonymous, as such a caller may not poll here', async () => {
      const anonymous = connect(scope, 'anonymous-session', { declaresChannels: true });
      const overStdio = connect(scope, 'stdio-session', { stdio: true });

      await publisherOf(scope).publish(deployFinished, deploy);

      expect(anonymous).not.toHaveBeenCalled();
      expect(overStdio).not.toHaveBeenCalled();
    });

    it("sends an event to the sessions its authorities allow, and not to the others'", async () => {
      const toAda = connect(scope, 'ada-session', { declaresChannels: true, caller: ada });
      const toBob = connect(scope, 'bob-session', { declaresChannels: true, caller: bob });

      await publisherOf(scope).publish(auditLogged, { action: 'export' });

      expect(messagesOf(toAda)).toEqual([expect.objectContaining({ content: '{"action":"export"}' })]);
      expect(toBob).not.toHaveBeenCalled();
    });

    it('runs authorize() for each session, on a context of its caller, and leaves out one it refuses', async () => {
      const toAda = connect(scope, 'ada-session', { declaresChannels: true, caller: ada });
      const toBob = connect(scope, 'bob-session', { declaresChannels: true, caller: bob });
      vaultAuthorize.mockImplementation((_args: unknown, subscriber: EventSubscriber) => {
        if (subscriber.sub === 'bob') throw new EventForbiddenError(EVENTS_ERROR_CODES, 'vault.opened', 'not yours');
      });

      await publisherOf(scope).publish(vaultOpened, { vaultId: 'v-1' });

      expect(messagesOf(toAda)).toHaveLength(1);
      expect(toBob).not.toHaveBeenCalled();
      expect(vaultAuthorize).toHaveBeenCalledWith({}, expect.objectContaining({ sub: 'ada', roles: ['admin'] }));
      expect(vaultSeenBy).toHaveBeenCalledWith(ada);
    });

    it('sends nothing to a session whose caller was last seen with credentials that have expired', async () => {
      const expired = callerNamed('ada', ['admin'], secondsFromNow(-60));
      const toAda = connect(scope, 'ada-session', { declaresChannels: true, caller: expired });
      const toBob = connect(scope, 'bob-session', { declaresChannels: true, caller: bob });

      await publisherOf(scope).publish(deployFinished, deploy);

      expect(toAda).not.toHaveBeenCalled();
      expect(messagesOf(toBob)).toHaveLength(1);
    });

    it('sends to a session whose credentials expire later', async () => {
      const valid = callerNamed('ada', ['admin'], secondsFromNow(3600));
      const toAda = connect(scope, 'ada-session', { declaresChannels: true, caller: valid });

      await publisherOf(scope).publish(deployFinished, deploy);

      expect(messagesOf(toAda)).toHaveLength(1);
    });

    it('sends again once a later request of the session came with fresh credentials', async () => {
      const expired = callerNamed('ada', ['admin'], secondsFromNow(-60));
      const toAda = connect(scope, 'ada-session', { declaresChannels: true, caller: expired });
      await publisherOf(scope).publish(deployFinished, deploy);
      expect(toAda).not.toHaveBeenCalled();

      scope.notifications.setCaller('ada-session', callerNamed('ada', ['admin'], secondsFromNow(3600)));
      const { eventId } = await publisherOf(scope).publish(deployFinished, deploy);

      expect(messagesOf(toAda)).toEqual([
        expect.objectContaining({ meta: expect.objectContaining({ event_id: eventId }) }),
      ]);
    });

    it("stops sending an event once a later request's claims lost the role its authorities need", async () => {
      const toAda = connect(scope, 'ada-session', { declaresChannels: true, caller: ada });
      await publisherOf(scope).publish(auditLogged, { action: 'export' });
      expect(messagesOf(toAda)).toHaveLength(1);

      scope.notifications.setCaller('ada-session', callerNamed('ada', ['member']));
      await publisherOf(scope).publish(auditLogged, { action: 'delete' });

      expect(messagesOf(toAda)).toHaveLength(1);
    });

    it('leaves out a session whose access could not be checked, and still sends to the others', async () => {
      const toBob = connect(scope, 'bob-session', { declaresChannels: true, caller: bob });
      const toAda = connect(scope, 'ada-session', { declaresChannels: true, caller: ada });
      vaultAuthorize.mockImplementation((_args: unknown, subscriber: EventSubscriber) => {
        if (subscriber.sub === 'bob') throw new Error('policy store down');
      });

      await expect(publisherOf(scope).publish(vaultOpened, { vaultId: 'v-2' })).resolves.toMatchObject({ matched: 0 });

      expect(toBob).not.toHaveBeenCalled();
      expect(messagesOf(toAda)).toHaveLength(1);
    });
  });

  describe('to a session of createInMemoryServer(), on a server that signs callers in', () => {
    let scope: Scope;
    const admin: Partial<AuthInfo> = { token: 'bearer-of-ada', user: { sub: 'ada', roles: ['admin'] } as never };
    const member: Partial<AuthInfo> = { token: 'bearer-of-ada', user: { sub: 'ada', roles: ['member'] } as never };
    let closeSession: (() => Promise<void>) | undefined;

    beforeAll(async () => {
      scope = await startScope({
        apps: [VaultsApp],
        auth: { mode: 'local' } as never,
        authorities: { profiles: { admin: { roles: { any: ['admin'] } } } },
      });
    });

    afterEach(async () => {
      await closeSession?.();
      closeSession = undefined;
    });

    afterAll(async () => {
      await scope.dispose();
    });

    /** Connects a client that declares the channel capability, and keeps the channel notifications it gets. */
    async function connectClient(authInfo: Partial<AuthInfo>) {
      const server = await createInMemoryServer(scope, { authInfo, sessionId: 'in-memory-session' });
      const client = new Client(
        { name: 'channel-client', version: '1.0.0' },
        { capabilities: { experimental: { 'claude/channel': {} } } },
      );
      const received: unknown[] = [];
      client.fallbackNotificationHandler = async (notification) => {
        if (notification.method === CHANNEL_NOTIFICATION) received.push(notification.params);
      };
      closeSession = async () => {
        await client.close();
        await server.close();
      };
      await client.connect(server.clientTransport);
      return { server, received };
    }

    it('checks each occurrence against the caller of the latest request, and keeps no token of it', async () => {
      const { server, received } = await connectClient(admin);

      await publisherOf(scope).publish(auditLogged, { action: 'export' });
      await until(() => received.length >= 1);
      server.setAuthInfo(member);
      await publisherOf(scope).publish(auditLogged, { action: 'delete' });
      server.setAuthInfo(admin);
      await publisherOf(scope).publish(auditLogged, { action: 'archive' });
      await until(() => received.length >= 2);

      const kept = scope.notifications.getRegisteredServer('in-memory-session')?.caller;
      expect(received).toEqual([
        expect.objectContaining({ content: '{"action":"export"}' }),
        expect.objectContaining({ content: '{"action":"archive"}' }),
      ]);
      expect(kept).toEqual({ user: { sub: 'ada', roles: ['admin'] } });
      expect(JSON.stringify(kept)).not.toContain('bearer-of-ada');
    });

    it('sends nothing while the credentials of the latest request have expired', async () => {
      const { server, received } = await connectClient({ ...admin, expiresAt: secondsFromNow(-60) });

      await publisherOf(scope).publish(deployFinished, deploy);
      server.setAuthInfo({ ...admin, expiresAt: secondsFromNow(3600) });
      const { eventId } = await publisherOf(scope).publish(deployFinished, deploy);
      await until(() => received.length >= 1);

      expect(received).toEqual([expect.objectContaining({ meta: { event: 'deploy.finished', event_id: eventId } })]);
    });
  });

  describe('with channels.enabled: false', () => {
    beforeEach(() => {
      logLines.length = 0;
    });

    it('sends nothing, serves no Claude Code channel, and warns once with the events it ignores', async () => {
      const scope = await startScope({ channels: { enabled: false }, logging: capturedLogging });
      const overStdio = connect(scope, 'stdio-session', { stdio: true });

      await publisherOf(scope).publish(deployFinished, deploy);

      expect(overStdio).not.toHaveBeenCalled();
      expect(servesClaudeCodeChannels(scope)).toBe(false);
      expect(buildScopedServerOptions(scope).capabilities.experimental).toBeUndefined();
      expect(await composeCallerInstructions(scope)).not.toContain('<channel>');
      expect(logLines.filter((line) => line.includes('channel option'))).toEqual([
        'Channels are disabled (channels.enabled: false), so the channel option of 5 event(s) is ignored: ' +
          '"deploy.finished", "deploy.described", "deploy.untold", "agent.noted", "deploy.filtered". ' +
          'Remove channels.enabled: false to send them to Claude Code sessions.',
      ]);
      await scope.dispose();
    });

    it('does not warn when no event has the option', async () => {
      const scope = await startScope({ apps: [LogsApp], channels: { enabled: false }, logging: capturedLogging });

      expect(logLines.filter((line) => line.includes('channel option'))).toEqual([]);
      await scope.dispose();
    });

    it('sends events with channels.enabled: true as well', async () => {
      const scope = await startScope({ channels: { enabled: true } });
      const overStdio = connect(scope, 'stdio-session', { stdio: true });

      await publisherOf(scope).publish(deployFinished, deploy);

      expect(messagesOf(overStdio)).toHaveLength(1);
      await scope.dispose();
    });
  });
});
