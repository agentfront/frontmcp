import { connect } from 'node:net';

import { generateStandardWebhookSecret, signingKeyOf, webhookSignatureHeaders } from '@frontmcp/utils';

import { WebhookReceiver } from '../webhook-receiver';

const SECRET = generateStandardWebhookSecret();
const eventBody = JSON.stringify({
  eventId: 'evt_1',
  name: 'order.created',
  timestamp: '2026-11-10T10:00:00Z',
  data: {},
});

function signedHeaders(body: string, secret = SECRET, webhookId = 'msg_1'): Record<string, string> {
  const message = { id: webhookId, timestamp: Math.floor(Date.now() / 1000), body };
  return {
    'content-type': 'application/json',
    'x-mcp-subscription-id': 'sub_0001',
    ...webhookSignatureHeaders(message, [signingKeyOf(secret)]),
  };
}

function post(url: string, body: string, headers: Record<string, string> = signedHeaders(body)): Promise<Response> {
  return fetch(url, { method: 'POST', headers, body });
}

describe('WebhookReceiver', () => {
  let receiver: WebhookReceiver;

  afterEach(async () => {
    await receiver.stop();
  });

  it('listens on a loopback port and gives the callback URL', async () => {
    receiver = new WebhookReceiver({ path: '/hooks/orders', port: 0 });

    const info = await receiver.start();

    expect(info.url).toBe(`http://127.0.0.1:${info.port}/hooks/orders`);
    expect(info.origin).toBe(`http://127.0.0.1:${info.port}`);
    expect(receiver.url).toBe(info.url);
  });

  it('has no URL before it is started and after it is stopped', async () => {
    receiver = new WebhookReceiver();
    expect(() => receiver.url).toThrow('WebhookReceiver is not started');

    await receiver.start();
    await receiver.stop();
    await receiver.stop();

    expect(() => receiver.url).toThrow('WebhookReceiver is not started');
  });

  it('echoes a verification challenge and records it', async () => {
    receiver = new WebhookReceiver({ secrets: [SECRET] });
    const { url } = await receiver.start();
    const body = JSON.stringify({ type: 'verification', challenge: 'nonce-1' });

    const response = await post(url, body, signedHeaders(body, SECRET, 'msg_verification_1'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ challenge: 'nonce-1' });
    expect(receiver.verifications()).toEqual([
      expect.objectContaining({
        kind: 'verification',
        path: '/hooks/mcp',
        body,
        json: { type: 'verification', challenge: 'nonce-1' },
        webhookId: 'msg_verification_1',
        subscriptionId: 'sub_0001',
        signatureCheck: 'valid',
        answeredStatus: 200,
      }),
    ]);
    expect(receiver.deliveries()).toEqual([]);
  });

  it('can be told not to echo the challenge', async () => {
    receiver = new WebhookReceiver();
    const { url } = await receiver.start();
    receiver.echoChallenges(false);

    const response = await post(url, JSON.stringify({ type: 'verification', challenge: 'nonce-1' }));

    await expect(response.json()).resolves.toEqual({});
  });

  it('records an event delivery with the headers it was signed with', async () => {
    receiver = new WebhookReceiver({ secrets: [SECRET] });
    const { url } = await receiver.start();

    const response = await post(`${url}?tenant=acme`, eventBody);

    expect(response.status).toBe(200);
    const [delivery] = receiver.deliveries();
    expect(delivery).toMatchObject({ kind: 'event', path: '/hooks/mcp', body: eventBody, signatureCheck: 'valid' });
    expect(delivery.webhookTimestamp).toMatch(/^\d+$/);
    expect(delivery.webhookSignature).toMatch(/^v1,/);
    expect(receiver.requests).toHaveLength(1);
  });

  it.each([
    ['a request signed with another secret', signedHeaders(eventBody, generateStandardWebhookSecret()), 'mismatch'],
    ['a request without signature headers', { 'content-type': 'application/json' }, 'missing'],
  ])('answers %s with 401 and records why', async (_label, headers, signatureCheck) => {
    receiver = new WebhookReceiver({ secrets: [SECRET] });
    const { url } = await receiver.start();

    const response = await post(url, eventBody, headers);

    expect(response.status).toBe(401);
    expect(receiver.requests[0]).toMatchObject({ signatureCheck, answeredStatus: 401 });
  });

  it('accepts a second secret, as after a rotation', async () => {
    receiver = new WebhookReceiver({ secrets: [SECRET] });
    const { url } = await receiver.start();
    const rotated = generateStandardWebhookSecret();
    receiver.addSecret(rotated);

    const response = await post(url, eventBody, signedHeaders(eventBody, rotated));

    expect(response.status).toBe(200);
  });

  it('checks nothing without a secret', async () => {
    receiver = new WebhookReceiver();
    const { url } = await receiver.start();

    const response = await post(url, 'not json', { 'content-type': 'text/plain' });

    expect(response.status).toBe(200);
    expect(receiver.requests[0]).toMatchObject({ kind: 'event', json: undefined, signatureCheck: 'unchecked' });
  });

  it('fails the next deliveries when told to, and never a verification', async () => {
    receiver = new WebhookReceiver();
    const { url } = await receiver.start();
    receiver.failNext(2, 503);

    const verification = await post(url, JSON.stringify({ type: 'verification', challenge: 'nonce-1' }));
    const first = await post(url, eventBody);
    const second = await post(url, eventBody);
    const third = await post(url, eventBody);

    expect(verification.status).toBe(200);
    expect([first.status, second.status, third.status]).toEqual([503, 503, 200]);
    expect(receiver.deliveries().map((delivery) => delivery.answeredStatus)).toEqual([503, 503, 200]);
  });

  it('fails with 500 unless told another status', async () => {
    receiver = new WebhookReceiver();
    const { url } = await receiver.start();
    receiver.failNext(1);

    await expect(post(url, eventBody)).resolves.toMatchObject({ status: 500 });
  });

  it.each(['gap', 'terminated'] as const)('records a %s envelope as its own kind', async (type) => {
    receiver = new WebhookReceiver();
    const { url } = await receiver.start();

    await post(url, JSON.stringify({ type }));

    expect(receiver.requests[0].kind).toBe(type);
    expect(receiver.deliveries()).toEqual([]);
  });

  it('serves the well-known document only when it declares path prefixes', async () => {
    receiver = new WebhookReceiver({ receivers: ['/hooks/'] });
    const declaring = await receiver.start();
    const silent = new WebhookReceiver();
    const undeclared = await silent.start();

    const declared = await fetch(`${declaring.origin}/.well-known/mcp-webhook-receiver.json`);
    const missing = await fetch(`${undeclared.origin}/.well-known/mcp-webhook-receiver.json`);

    await expect(declared.json()).resolves.toEqual({ receivers: ['/hooks/'] });
    expect(missing.status).toBe(404);
    await silent.stop();
  });

  it('answers another method with 405', async () => {
    receiver = new WebhookReceiver();
    const { url } = await receiver.start();

    await expect(fetch(url, { method: 'PUT', body: '{}' })).resolves.toMatchObject({ status: 405 });
  });

  it('survives a caller that drops the connection in the middle of the body', async () => {
    receiver = new WebhookReceiver();
    const { url, port } = await receiver.start();
    const unhandled = jest.fn();
    process.on('unhandledRejection', unhandled);

    await new Promise<void>((resolve) => {
      const socket = connect(port, '127.0.0.1', () => {
        socket.write('POST /hooks/mcp HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: 1000\r\n\r\n{"partial":');
        setTimeout(() => {
          socket.destroy();
          resolve();
        }, 20);
      });
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    process.off('unhandledRejection', unhandled);

    expect(unhandled).not.toHaveBeenCalled();
    expect(receiver.requests).toHaveLength(0);
    await expect(post(url, eventBody)).resolves.toMatchObject({ status: 200 });
  });

  it('waits for deliveries, and says how many arrived when they do not', async () => {
    receiver = new WebhookReceiver();
    const { url } = await receiver.start();
    setTimeout(() => void post(url, eventBody), 30);

    await expect(receiver.waitForDeliveries(1)).resolves.toHaveLength(1);
    await expect(receiver.waitForDeliveries(2, 60)).rejects.toThrow('1 of 2 deliveries arrived in 60 ms');
  });

  it('forgets what it received when cleared', async () => {
    receiver = new WebhookReceiver();
    const { url } = await receiver.start();
    await post(url, eventBody);

    receiver.clear();

    expect(receiver.requests).toEqual([]);
  });
});
