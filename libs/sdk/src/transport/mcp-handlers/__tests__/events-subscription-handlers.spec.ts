/**
 * `events/subscribe` and `events/unsubscribe` answer over a session opened with `initialize` and under protocol
 * 2026-07-28, on a server whose auth signs callers in, against a receiver that echoes the verification challenge.
 */
import 'reflect-metadata';

import * as http from 'node:http';
import { type AddressInfo } from 'node:net';

import { z } from '@frontmcp/lazy-zod';
import { MCP_20260728_META, type JSONRPCMessage, type Transport } from '@frontmcp/protocol';
import { generateStandardWebhookSecret, signingKeyOf, verifyWebhookSignature } from '@frontmcp/utils';

import {
  createTestFetchServer,
  createTestJwtIssuer,
  rpc20260728,
  type TestFetchServer,
  type TestJwtIssuer,
} from '../../../__test-utils__/helpers/mcp-20260728.helpers';
import { App, event } from '../../../common';
import { type Scope } from '../../../scope/scope.instance';
import { createInMemoryServer } from '../../in-memory-server';
import { createMcpHandlers } from '../index';
import { type McpHandlerOptions } from '../mcp-handlers.types';

const SECRET = generateStandardWebhookSecret();
const payloadSchema = { orderId: z.string() };

const orderCreated = event({ name: 'order.created', inputSchema: { status: z.string().optional() }, payloadSchema });
const auditLogged = event({ name: 'audit.logged', payloadSchema, authorities: 'admin' });

@App({ id: 'shop', name: 'Shop', events: [orderCreated, auditLogged] })
class ShopApp {}

type JsonRpcReply = {
  result?: Record<string, unknown>;
  error?: { code: number; message: string; data?: Record<string, unknown> };
};

interface ReceivedRequest {
  headers: http.IncomingHttpHeaders;
  body: string;
}

/** A session-era client that reads the replies as they are on the wire. */
class RawSessionClient {
  private nextId = 1;
  private readonly waiting = new Map<number, (reply: JsonRpcReply) => void>();

  constructor(private readonly transport: Transport) {
    transport.onmessage = (message) => {
      const reply = message as JsonRpcReply & { id?: number };
      if (reply.id === undefined) return;
      this.waiting.get(reply.id)?.(reply);
      this.waiting.delete(reply.id);
    };
  }

  async initialize(clientName: string): Promise<JsonRpcReply> {
    await this.transport.start();
    const reply = await this.request('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: clientName, version: '1.0.0' },
    });
    await this.transport.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    return reply;
  }

  request(method: string, params?: Record<string, unknown>): Promise<JsonRpcReply> {
    const id = this.nextId++;
    const reply = new Promise<JsonRpcReply>((resolve) => this.waiting.set(id, resolve));
    void this.transport.send({ jsonrpc: '2.0', id, method, ...(params && { params }) } as JSONRPCMessage);
    return reply;
  }
}

function scopeOf(server: TestFetchServer): Scope {
  return server.instance.getScopes()[0] as Scope;
}

describe('events/subscribe and events/unsubscribe', () => {
  let issuer: TestJwtIssuer;
  let server: TestFetchServer;
  let receiver: http.Server;
  let callback: string;
  const received: ReceivedRequest[] = [];

  function verificationsReceived(): ReceivedRequest[] {
    return received.filter((request) => request.body.includes('"verification"'));
  }

  function subscription(status: string, overrides: Record<string, unknown> = {}) {
    return { name: 'order.created', arguments: { status }, delivery: { url: callback, secret: SECRET }, ...overrides };
  }

  beforeAll(async () => {
    receiver = http.createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        if (request.method !== 'POST') {
          response.writeHead(404).end();
          return;
        }
        received.push({ headers: request.headers, body });
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ challenge: JSON.parse(body).challenge }));
      });
    });
    await new Promise<void>((resolve) => receiver.listen(0, '127.0.0.1', resolve));
    callback = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}/hooks/mcp`;

    issuer = await createTestJwtIssuer();
    server = await createTestFetchServer({
      info: { name: 'events-subscription-handlers', version: '1.0.0' },
      apps: [ShopApp],
      auth: {
        mode: 'transparent',
        provider: issuer.issuer,
        providerConfig: { jwks: issuer.jwks },
        allowAnonymous: true,
      } as never,
      authorities: { profiles: { admin: { roles: { any: ['admin'] } } } },
      events: { webhook: { unsafeAllowLocalCallbacks: true } },
    });
  });

  beforeEach(() => {
    received.length = 0;
  });

  afterAll(async () => {
    await scopeOf(server).dispose();
    await new Promise((resolve) => receiver.close(resolve));
  });

  describe('over a session opened with initialize', () => {
    async function openSession(authInfo: Record<string, unknown>, clientName = 'raw-session-client') {
      const inMemory = await createInMemoryServer(scopeOf(server), { authInfo: authInfo as never });
      const client = new RawSessionClient(inMemory.clientTransport);
      const initialized = await client.initialize(clientName);
      return { client, initialized, close: inMemory.close };
    }

    const ada = { user: { sub: 'ada', iss: 'https://auth.example.com', roles: ['member'] } };

    it('advertises events in both forms and lists them as webhook events, with no mode enabled by hand', async () => {
      const { client, initialized, close } = await openSession(ada);
      const capabilities = initialized.result?.['capabilities'] as Record<string, unknown>;

      const listed = await client.request('events/list', {});

      expect(capabilities['events']).toEqual({});
      expect(capabilities['extensions']).toMatchObject({ 'io.modelcontextprotocol/events': {} });
      expect(listed.result?.['events']).toEqual([
        expect.objectContaining({ name: 'order.created', delivery: ['poll', 'webhook'] }),
      ]);
      await close();
    });

    it('creates a subscription after one signed verification request, and refreshes it without another', async () => {
      const { client, close } = await openSession(ada);

      const created = await client.request('events/subscribe', subscription('session-case'));
      const refreshed = await client.request('events/subscribe', subscription('session-case'));

      expect(created.error).toBeUndefined();
      expect(created.result).toEqual({
        id: expect.stringMatching(/^sub_[0-9a-f]{32}$/),
        refreshBefore: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
        cursor: null,
        truncated: false,
      });
      expect(refreshed.result).toMatchObject({
        id: created.result?.['id'],
        deliveryStatus: { active: true, lastDeliveryAt: null, lastError: null, failedSince: null },
      });

      const verifications = verificationsReceived();
      expect(verifications).toHaveLength(1);
      const { headers, body } = verifications[0];
      expect(headers['x-mcp-subscription-id']).toBe(created.result?.['id']);
      expect(headers['webhook-id']).toMatch(/^msg_verification_/);
      expect(
        verifyWebhookSignature(
          {
            id: headers['webhook-id'] as string,
            timestamp: headers['webhook-timestamp'] as string,
            signature: headers['webhook-signature'] as string,
            body,
          },
          [signingKeyOf(SECRET)],
        ),
      ).toBe('valid');
      await close();
    });

    it('removes a subscription, and succeeds again when it is gone', async () => {
      const { client, close } = await openSession(ada);
      const { delivery, ...key } = subscription('removal-case');
      await client.request('events/subscribe', { ...key, delivery });

      const removed = await client.request('events/unsubscribe', { ...key, delivery: { url: delivery.url } });
      const again = await client.request('events/unsubscribe', { ...key, delivery: { url: delivery.url } });

      expect(removed.result).toEqual({});
      expect(again.result).toEqual({});
      await close();
    });

    it('answers a refusal with the SEP-3415 code and its data', async () => {
      const { client, close } = await openSession(ada);

      const unknown = await client.request('events/subscribe', subscription('x', { name: 'order.refunded' }));
      const forbidden = await client.request('events/subscribe', {
        name: 'audit.logged',
        delivery: { url: callback, secret: SECRET },
      });
      const invalid = await client.request('events/subscribe', subscription('x', { arguments: { status: 7 } }));

      expect(unknown.error).toMatchObject({ code: -32023, data: { kind: 'event', name: 'order.refunded' } });
      expect(forbidden.error).toMatchObject({ code: -32024 });
      expect(invalid.error).toMatchObject({ code: -32602 });
      await close();
    });

    it('answers a client that names itself ChatGPT at initialize with the sketch codes', async () => {
      const { client, close } = await openSession(ada, 'chatgpt');

      const unknown = await client.request('events/subscribe', subscription('x', { name: 'order.refunded' }));
      const forbidden = await client.request('events/subscribe', {
        name: 'audit.logged',
        delivery: { url: callback, secret: SECRET },
      });

      expect(unknown.error).toMatchObject({ code: -32011 });
      expect(forbidden.error).toMatchObject({ code: -32012 });
      await close();
    });

    it('refuses an anonymous caller', async () => {
      const { client, close } = await openSession({ user: { sub: 'anon:7c1e' } });

      const refused = await client.request('events/subscribe', subscription('anonymous-case'));
      const removal = await client.request('events/unsubscribe', {
        name: 'order.created',
        delivery: { url: callback },
      });

      expect(refused.error).toMatchObject({ code: -32024 });
      expect(removal.error).toMatchObject({ code: -32024 });
      expect(verificationsReceived()).toHaveLength(0);
      await close();
    });
  });

  describe('under protocol 2026-07-28', () => {
    async function bearer(subject: string, roles: string[] = []): Promise<Record<string, string>> {
      return { authorization: `Bearer ${await issuer.sign({ roles }, subject)}` };
    }

    it('creates, refreshes and removes a subscription of the token subject, with resultType complete', async () => {
      const headers = await bearer('carol');

      const created = await rpc20260728(server.handler, 'events/subscribe', subscription('stateless-case'), {
        headers,
      });
      const refreshed = await rpc20260728(server.handler, 'events/subscribe', subscription('stateless-case'), {
        headers,
      });
      const removed = await rpc20260728(
        server.handler,
        'events/unsubscribe',
        { name: 'order.created', arguments: { status: 'stateless-case' }, delivery: { url: callback } },
        { headers },
      );

      expect(created.message.error).toBeUndefined();
      expect(created.message.result).toMatchObject({ resultType: 'complete', cursor: null, truncated: false });
      expect(refreshed.message.result?.['id']).toBe(created.message.result?.['id']);
      expect(removed.message.result).toMatchObject({ resultType: 'complete' });
      expect(verificationsReceived()).toHaveLength(1);

      const stored = await scopeOf(server).events?.subscriptions?.store.get(created.message.result?.['id'] as string);
      expect(stored).toBeUndefined();
    });

    it('gives two token subjects two subscriptions for the same request', async () => {
      const one = await rpc20260728(server.handler, 'events/subscribe', subscription('two-owners'), {
        headers: await bearer('dave'),
      });
      const other = await rpc20260728(server.handler, 'events/subscribe', subscription('two-owners'), {
        headers: await bearer('erin'),
      });

      expect(one.message.result?.['id']).toMatch(/^sub_/);
      expect(other.message.result?.['id']).toMatch(/^sub_/);
      expect(other.message.result?.['id']).not.toBe(one.message.result?.['id']);
    });

    it('answers a client that names itself ChatGPT with the sketch codes, and any other with the SEP-3415 ones', async () => {
      const headers = await bearer('frank');
      const asChatGpt = { headers, meta: { [MCP_20260728_META.clientInfo]: { name: 'chatgpt', version: '1.0.0' } } };
      const unknownEvent = subscription('x', { name: 'order.refunded' });
      const guardedEvent = { name: 'audit.logged', delivery: { url: callback, secret: SECRET } };

      const sketchUnknown = await rpc20260728(server.handler, 'events/subscribe', unknownEvent, asChatGpt);
      const sketchForbidden = await rpc20260728(server.handler, 'events/subscribe', guardedEvent, asChatGpt);
      const sepUnknown = await rpc20260728(server.handler, 'events/subscribe', unknownEvent, { headers });
      const sepForbidden = await rpc20260728(server.handler, 'events/subscribe', guardedEvent, { headers });

      expect(sketchUnknown.message.error).toMatchObject({ code: -32011 });
      expect(sketchForbidden.message.error).toMatchObject({ code: -32012 });
      expect(sepUnknown.message.error).toMatchObject({ code: -32023 });
      expect(sepForbidden.message.error).toMatchObject({ code: -32024 });
    });

    it('lets a caller the authorities allow subscribe to a guarded event', async () => {
      const allowed = await rpc20260728(
        server.handler,
        'events/subscribe',
        { name: 'audit.logged', delivery: { url: callback, secret: SECRET } },
        { headers: await bearer('grace', ['admin']) },
      );

      expect(allowed.message.error).toBeUndefined();
    });

    it('refuses a caller without a token', async () => {
      const refused = await rpc20260728(server.handler, 'events/subscribe', subscription('no-token'));

      expect(refused.message.error).toMatchObject({ code: -32024 });
    });

    it('answers a callback that does not echo the challenge with CallbackEndpointError', async () => {
      const silent = http.createServer((_request, response) => response.writeHead(200).end('{}'));
      await new Promise<void>((resolve) => silent.listen(0, '127.0.0.1', resolve));
      const silentCallback = `http://127.0.0.1:${(silent.address() as AddressInfo).port}/hooks/mcp`;

      const refused = await rpc20260728(
        server.handler,
        'events/subscribe',
        subscription('silent', { delivery: { url: silentCallback, secret: SECRET } }),
        { headers: await bearer('heidi') },
      );

      expect(refused.message.error).toMatchObject({ code: -32027, data: { reason: 'challenge_failed' } });
      await new Promise((resolve) => silent.close(resolve));
    });

    it('refuses a request that is not a subscribe request', async () => {
      const refused = await rpc20260728(
        server.handler,
        'events/subscribe',
        { name: 'order.created' },
        { headers: await bearer('judy') },
      );

      expect(refused.message.error).toMatchObject({ code: -32602 });
    });

    it('requires the Mcp-Name header to name the event', async () => {
      const refused = await rpc20260728(server.handler, 'events/subscribe', subscription('header-case'), {
        headers: { ...(await bearer('ivan')), 'mcp-name': 'another.event' },
      });

      expect(refused.message.error?.message).toContain("does not match body value 'order.created'");
    });
  });

  describe('handler registration', () => {
    function methodsOf(options: McpHandlerOptions): string[] {
      return createMcpHandlers(options).map((handler) => handler.requestSchema.shape.method.value as string);
    }

    it('registers both handlers on a server that stores subscriptions', () => {
      const methods = methodsOf({ scope: scopeOf(server), serverOptions: {} } as McpHandlerOptions);

      expect(methods).toEqual(expect.arrayContaining(['events/list', 'events/subscribe', 'events/unsubscribe']));
    });

    it('registers neither on a server in public auth mode, which serves no events', async () => {
      const publicServer = await createTestFetchServer({
        info: { name: 'events-public-auth', version: '1.0.0' },
        apps: [ShopApp],
        authorities: { profiles: { admin: { roles: { any: ['admin'] } } } },
        events: { poll: { enabled: false } },
      });
      const scope = scopeOf(publicServer);

      const methods = methodsOf({ scope, serverOptions: {} } as McpHandlerOptions);
      const listed = await rpc20260728(publicServer.handler, 'events/subscribe', subscription('public'));

      expect(scope.events?.subscriptions).toBeUndefined();
      expect(scope.events?.servesEvents()).toBe(false);
      expect(methods).not.toEqual(expect.arrayContaining(['events/subscribe']));
      expect(methods).not.toEqual(expect.arrayContaining(['events/unsubscribe']));
      expect(listed.message.error).toMatchObject({ code: -32601 });
      await scope.dispose();
    });

    it('registers neither with events.webhook.enabled: false', async () => {
      const disabled = await createTestFetchServer({
        info: { name: 'events-webhook-off', version: '1.0.0' },
        apps: [ShopApp],
        auth: { mode: 'transparent', provider: issuer.issuer, providerConfig: { jwks: issuer.jwks } } as never,
        authorities: { profiles: { admin: { roles: { any: ['admin'] } } } },
        events: { webhook: { enabled: false }, poll: { enabled: false } },
      });
      const scope = scopeOf(disabled);

      expect(scope.events?.subscriptions).toBeUndefined();
      expect(scope.events?.servesEvents()).toBe(false);
      await scope.dispose();
    });
  });
});
