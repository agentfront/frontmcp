/**
 * Conformance of the routing headers of MCP Events under 2026-07-28 (SEP-3415 with SEP-2243): the `Mcp-Name` header
 * each method that names an event must carry. The `initialize` session sends no such header, so this is 2026-07-28 only.
 */
import { expect, WebhookReceiver } from '@frontmcp/testing';
import { generateStandardWebhookSecret } from '@frontmcp/utils';

import { ConformanceServer } from './conformance.helpers';

const HEADER_MISMATCH = -32020;

describe('Events conformance: routing headers', () => {
  let conformance: ConformanceServer;
  let receiver: WebhookReceiver;
  let token: string;
  const secret = generateStandardWebhookSecret();

  beforeAll(async () => {
    receiver = new WebhookReceiver();
    await receiver.start();
    conformance = await ConformanceServer.start();
    token = await conformance.token('ada');
  }, 60000);

  afterAll(async () => {
    if (conformance) await conformance.stop();
    if (receiver) await receiver.stop();
  });

  /** The request of each method that names an event. */
  function requestsNamingAnEvent(): Array<[string, Record<string, unknown>]> {
    const name = 'conformance.emitted';
    return [
      ['events/poll', { name, arguments: {}, cursor: null }],
      ['events/stream', { name, arguments: {}, cursor: null }],
      ['events/subscribe', { name, arguments: {}, delivery: { mode: 'webhook', url: receiver.url, secret } }],
      ['events/unsubscribe', { name, arguments: {}, delivery: { mode: 'webhook', url: receiver.url } }],
    ];
  }

  it('answers events/list, which names no event, without Mcp-Name', async () => {
    const response = await conformance.post('events/list', {}, { token, mcpName: null });

    expect(response.status).toBe(200);
    expect((await response.json()).result.events.length).toBeGreaterThan(0);
  });

  it('refuses each method that names an event without Mcp-Name, with 400 and HeaderMismatch', async () => {
    for (const [method, params] of requestsNamingAnEvent()) {
      const response = await conformance.post(method, params, { token, mcpName: null });

      expect({ method, status: response.status, type: response.headers.get('content-type') }).toEqual({
        method,
        status: 400,
        type: expect.stringContaining('application/json'),
      });
      expect((await response.json()).error.code).toBe(HEADER_MISMATCH);
    }
    expect(receiver.requests).toHaveLength(0);
  });

  it('refuses each method that names an event when Mcp-Name differs from params.name, with 400 and HeaderMismatch', async () => {
    for (const [method, params] of requestsNamingAnEvent()) {
      const response = await conformance.post(method, params, { token, mcpName: 'conformance.emitted-mismatch' });

      expect({ method, status: response.status }).toEqual({ method, status: 400 });
      expect((await response.json()).error.code).toBe(HEADER_MISMATCH);
    }
    expect(receiver.requests).toHaveLength(0);
  });

  it('accepts a name that is not plain ASCII when Mcp-Name carries it base64-encoded', async () => {
    const name = 'conformance.émis';
    const encoded = `=?base64?${Buffer.from(name, 'utf8').toString('base64')}?=`;

    const response = await conformance.post('events/poll', { name, cursor: null }, { token, mcpName: encoded });

    expect(response.status).toBe(200);
    expect((await response.json()).error).toMatchObject({ code: -32023, data: { kind: 'event' } });
  });
});
