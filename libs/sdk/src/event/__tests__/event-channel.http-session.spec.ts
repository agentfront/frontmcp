/**
 * An event with the `channel` option over real HTTP sessions that sign in with a bearer token: each session is
 * checked as the caller its requests verified, and one that stays open after its token expired gets nothing.
 */
import 'reflect-metadata';

import * as http from 'node:http';
import { type AddressInfo } from 'node:net';

import { z } from '@frontmcp/lazy-zod';
import { Client, StreamableHTTPClientTransport } from '@frontmcp/protocol/client';

import { createTestJwtIssuer, type TestJwtIssuer } from '../../__test-utils__/helpers/mcp-20260728.helpers';
import { App, event, LogLevel, Tool, ToolContext } from '../../common';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';

const CHANNEL_NOTIFICATION = 'notifications/claude/channel';
const ENTRY_PATH = '/mcp';
const SHORT_LIFETIME_SECONDS = 3;

const auditLogged = event({
  name: 'audit.logged',
  payloadSchema: { action: z.string() },
  authorities: 'admin',
  channel: true,
});

const noticePosted = event({ name: 'notice.posted', payloadSchema: { text: z.string() }, channel: true });

/** Publishes an audit entry, which only admins may see. */
@Tool({ name: 'log_audit', inputSchema: { action: z.string() } })
class LogAuditTool extends ToolContext {
  /** Publishes one occurrence of `audit.logged`. */
  async execute(input: { action: string }) {
    await this.events.publish(auditLogged, { action: input.action });
    return { logged: true };
  }
}

/** Publishes a notice, which every signed-in caller may see. */
@Tool({ name: 'post_notice', inputSchema: { text: z.string() } })
class PostNoticeTool extends ToolContext {
  /** Publishes one occurrence of `notice.posted`. */
  async execute(input: { text: string }) {
    await this.events.publish(noticePosted, { text: input.text });
    return { posted: true };
  }
}

/** Two events with `channel`: one guarded by the admin profile, one open to every signed-in caller. */
@App({ id: 'audit', name: 'Audit', tools: [LogAuditTool, PostNoticeTool], events: [auditLogged, noticePosted] })
class AuditApp {}

interface ChannelMessage {
  content: string;
  meta: Record<string, string>;
}

interface ChannelSession {
  client: Client;
  received: ChannelMessage[];
}

/** Waits until a condition holds. */
async function until(condition: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** The texts of the notices a session was sent. */
function noticesOf(session: ChannelSession): string[] {
  return session.received.filter((message) => message.meta['event'] === 'notice.posted').map(({ content }) => content);
}

/** The audit entries a session was sent. */
function auditsOf(session: ChannelSession): string[] {
  return session.received.filter((message) => message.meta['event'] === 'audit.logged').map(({ content }) => content);
}

describe('events:publish to HTTP sessions that sign in', () => {
  let issuer: TestJwtIssuer;
  let server: http.Server;
  let origin: string;
  const sessions: ChannelSession[] = [];
  const savedSessionSecret = process.env['MCP_SESSION_SECRET'];

  beforeAll(async () => {
    process.env['MCP_SESSION_SECRET'] = 'event-channel-http-session-spec-secret';
    issuer = await createTestJwtIssuer();
    const handler = (await FrontMcpInstance.createHandler({
      info: { name: 'event-channel-http', version: '1.0.0' },
      apps: [AuditApp],
      auth: { mode: 'transparent', provider: issuer.issuer, providerConfig: { jwks: issuer.jwks } } as never,
      authorities: { profiles: { admin: { roles: { any: ['admin'] } } } },
      http: { entryPath: ENTRY_PATH },
      logging: { level: LogLevel.Off },
    })) as http.RequestListener;
    server = http.createServer(handler);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    for (const session of sessions.splice(0)) await session.client.close().catch(() => undefined);
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
    if (savedSessionSecret === undefined) delete process.env['MCP_SESSION_SECRET'];
    else process.env['MCP_SESSION_SECRET'] = savedSessionSecret;
  });

  /** Opens a session that declares the channel capability, with a token of `roles` that lives `lifetimeSeconds`. */
  async function signIn(subject: string, roles: string[], lifetimeSeconds?: number): Promise<ChannelSession> {
    const expiry = lifetimeSeconds === undefined ? {} : { exp: Math.floor(Date.now() / 1000) + lifetimeSeconds };
    const token = await issuer.sign({ roles, ...expiry }, subject, { exp: lifetimeSeconds === undefined });
    const transport = new StreamableHTTPClientTransport(new URL(`${origin}${ENTRY_PATH}`), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    });
    const client = new Client(
      { name: 'channel-client', version: '1.0.0' },
      { capabilities: { experimental: { 'claude/channel': {} } } },
    );
    const session: ChannelSession = { client, received: [] };
    client.fallbackNotificationHandler = async (notification) => {
      if (notification.method === CHANNEL_NOTIFICATION) session.received.push(notification.params as never);
    };
    await client.connect(transport);
    sessions.push(session);
    return session;
  }

  /** Posts notices until every listener got one, so each has its notification stream open. */
  async function streamsOpen(publisher: ChannelSession, listeners: ChannelSession[]): Promise<void> {
    const deadline = Date.now() + 5_000;
    while (!listeners.every((listener) => noticesOf(listener).length > 0)) {
      if (Date.now() > deadline) throw new Error('a session got no notice in time');
      await publisher.client.callTool({ name: 'post_notice', arguments: { text: 'stream check' } });
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  it('sends a guarded event to the session of a caller its authorities allow, and not to another', async () => {
    const admin = await signIn('ada', ['admin']);
    const member = await signIn('bob', ['member']);
    await streamsOpen(admin, [admin, member]);

    await admin.client.callTool({ name: 'log_audit', arguments: { action: 'export' } });
    await admin.client.callTool({ name: 'post_notice', arguments: { text: 'after the audit entry' } });
    await until(() => noticesOf(member).includes('{"text":"after the audit entry"}'));
    await until(() => auditsOf(admin).length === 1);

    expect(auditsOf(admin)).toEqual(['{"action":"export"}']);
    expect(auditsOf(member)).toEqual([]);
  });

  it('sends nothing to a session that stays open after its token expired', async () => {
    const admin = await signIn('ada', ['admin']);
    const shortLived = await signIn('carol', ['admin'], SHORT_LIFETIME_SECONDS);
    await streamsOpen(admin, [admin, shortLived]);
    const expiresAt = Date.now() + SHORT_LIFETIME_SECONDS * 1000;
    await until(() => Date.now() > expiresAt, SHORT_LIFETIME_SECONDS * 1000 + 2_000);
    const noticesBefore = noticesOf(shortLived).length;

    await admin.client.callTool({ name: 'log_audit', arguments: { action: 'rotate' } });
    await admin.client.callTool({ name: 'post_notice', arguments: { text: 'after the token expired' } });
    await until(() => noticesOf(admin).includes('{"text":"after the token expired"}'));
    await until(() => auditsOf(admin).includes('{"action":"rotate"}'));

    expect(auditsOf(shortLived)).toEqual([]);
    expect(noticesOf(shortLived)).toHaveLength(noticesBefore);
  }, 15_000);
});
