import { generateStandardWebhookSecret, signingKeyOf, webhookSignatureHeaders } from '@frontmcp/utils';

import { createEventWebhookReceiver, WEBHOOK_DEDUPE_WINDOW } from '..';

const SHARED = generateStandardWebhookSecret();
const occurrence = { eventId: 'evt_1', name: 'order.created', timestamp: '2026-11-10T10:00:00Z', data: { id: 1 } };

/** A request signed with `secret`, for `subscriptionId`. */
function signed(
  body: unknown,
  { secret = SHARED, subscriptionId = 'sub_a', webhookId = 'msg_1', timestamp = Math.floor(Date.now() / 1000) } = {},
) {
  const rawBody = typeof body === 'string' ? body : JSON.stringify(body);
  const headers = {
    'X-MCP-Subscription-Id': subscriptionId,
    ...webhookSignatureHeaders({ id: webhookId, timestamp, body: rawBody }, [signingKeyOf(secret)]),
  };
  return { headers, rawBody };
}

describe('createEventWebhookReceiver', () => {
  it('hands a delivery signed with a shared secret to onEvent, and acknowledges it', async () => {
    const onEvent = jest.fn();
    const receiver = createEventWebhookReceiver({ secrets: [SHARED], onEvent });

    const response = await receiver.handle(signed(occurrence));

    expect(response).toEqual({ status: 200, signature: 'valid' });
    expect(onEvent).toHaveBeenCalledWith(occurrence, { subscriptionId: 'sub_a', webhookId: 'msg_1' });
  });

  it('reads headers from a Headers object and from arrays, whatever their case', async () => {
    const onEvent = jest.fn();
    const receiver = createEventWebhookReceiver({ secrets: [SHARED], onEvent });
    const { headers, rawBody } = signed(occurrence);
    const asArrays = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toUpperCase(), [value]]));

    const fromHeaders = await receiver.handle({ headers: new Headers(headers), rawBody });
    const fromArrays = await receiver.handle({ headers: asArrays, rawBody });

    expect([fromHeaders.signature, fromArrays.signature]).toEqual(['valid', 'valid']);
    expect(onEvent).toHaveBeenCalledTimes(1);
  });

  it('acknowledges a repeated webhook-id once, per subscription', async () => {
    const onEvent = jest.fn();
    const receiver = createEventWebhookReceiver({ secrets: [SHARED], onEvent });

    await receiver.handle(signed(occurrence));
    const repeated = await receiver.handle(signed(occurrence));
    await receiver.handle(signed(occurrence, { subscriptionId: 'sub_b' }));

    expect(repeated.status).toBe(200);
    expect(onEvent.mock.calls.map(([, delivery]) => delivery.subscriptionId)).toEqual(['sub_a', 'sub_b']);
  });

  it('forgets the oldest webhook-id past the window', async () => {
    const onEvent = jest.fn();
    const receiver = createEventWebhookReceiver({ secrets: [SHARED], onEvent });
    for (let index = 0; index <= WEBHOOK_DEDUPE_WINDOW; index++) {
      await receiver.handle(signed(occurrence, { webhookId: `msg_${index}` }));
    }

    await receiver.handle(signed(occurrence, { webhookId: 'msg_0' }));

    expect(onEvent).toHaveBeenCalledTimes(WEBHOOK_DEDUPE_WINDOW + 2);
  });

  it.each([
    ['without signature headers', { headers: { 'x-mcp-subscription-id': 'sub_a' }, rawBody: '{}' }, 'missing'],
    ['signed with another secret', signed(occurrence, { secret: generateStandardWebhookSecret() }), 'mismatch'],
    ['with a stale timestamp', signed(occurrence, { timestamp: Math.floor(Date.now() / 1000) - 600 }), 'stale'],
  ])('answers a request %s with 401', async (_label, request, signature) => {
    const receiver = createEventWebhookReceiver({ secrets: [SHARED] });

    await expect(receiver.handle(request)).resolves.toEqual({ status: 401, signature });
  });

  it('answers a delivery for a subscription it has no secret for with a retryable 503', async () => {
    const receiver = createEventWebhookReceiver();
    receiver.register({ secret: SHARED });

    await expect(receiver.handle(signed(occurrence))).resolves.toEqual({ status: 503 });
  });

  it('answers a verification with the unbound secret that signed it, and binds the subscription id to it', async () => {
    const secret = generateStandardWebhookSecret();
    const onEvent = jest.fn();
    const receiver = createEventWebhookReceiver();
    receiver.register({ secret: generateStandardWebhookSecret() });
    const registration = receiver.register({ secret, listener: { onEvent } });

    const answered = await receiver.handle(signed({ type: 'verification', challenge: 'nonce' }, { secret }));
    const delivered = await receiver.handle(signed(occurrence, { secret, webhookId: 'msg_2' }));

    expect(answered).toEqual({ status: 200, body: { challenge: 'nonce' }, signature: 'valid' });
    expect(registration.subscriptionId).toBe('sub_a');
    expect(delivered.status).toBe(200);
    expect(onEvent).toHaveBeenCalledWith(occurrence, { subscriptionId: 'sub_a', webhookId: 'msg_2' });
  });

  it('hands the deliveries of a registration without a listener to the receiver callbacks', async () => {
    const onEvent = jest.fn();
    const receiver = createEventWebhookReceiver({ onEvent });
    receiver.register({ secret: SHARED, subscriptionId: 'sub_a' });

    await receiver.handle(signed(occurrence));

    expect(onEvent).toHaveBeenCalledTimes(1);
  });

  it('binds a verification to an unbound secret only, and reads a missing subscription id as empty', async () => {
    const secret = generateStandardWebhookSecret();
    const receiver = createEventWebhookReceiver();
    receiver.register({ secret, subscriptionId: 'sub_other' });
    const unbound = receiver.register({ secret });
    const { headers, rawBody } = signed({ type: 'verification', challenge: 'nonce' }, { secret });
    const { 'X-MCP-Subscription-Id': _subscriptionId, ...withoutId } = headers;

    const answered = await receiver.handle({ headers: new Headers(withoutId), rawBody });

    expect(answered.status).toBe(200);
    expect(unbound.subscriptionId).toBe('');
  });

  it('answers a verification again for a subscription it knows', async () => {
    const receiver = createEventWebhookReceiver();
    receiver.register({ secret: SHARED, subscriptionId: 'sub_a' });

    const answered = await receiver.handle(signed({ type: 'verification', challenge: 'again' }));

    expect(answered.body).toEqual({ challenge: 'again' });
  });

  it('refuses a verification no secret signed, and a stale one', async () => {
    const receiver = createEventWebhookReceiver();
    const verification = { type: 'verification', challenge: 'nonce' };
    const empty = createEventWebhookReceiver();
    receiver.register({ secret: SHARED });

    const unsigned = await receiver.handle(signed(verification, { secret: generateStandardWebhookSecret() }));
    const stale = await receiver.handle(signed(verification, { timestamp: 1 }));
    const nobody = await empty.handle(signed(verification));

    expect(unsigned).toEqual({ status: 401, signature: 'mismatch' });
    expect(stale).toEqual({ status: 401, signature: 'stale' });
    expect(nobody).toEqual({ status: 401, signature: 'mismatch' });
  });

  it('routes gap and terminated envelopes to the listener of the subscription', async () => {
    const listener = { onGap: jest.fn(), onTerminated: jest.fn() };
    const receiver = createEventWebhookReceiver();
    receiver.register({ secret: SHARED, subscriptionId: 'sub_a', listener });
    const error = { code: -32024, message: 'Forbidden', data: { reason: 'Access revoked' } };

    await receiver.handle(signed({ type: 'gap', cursor: 'c-9' }, { webhookId: 'msg_gap_1' }));
    await receiver.handle(signed({ type: 'gap' }, { webhookId: 'msg_gap_2' }));
    await receiver.handle(signed({ type: 'terminated', error }, { webhookId: 'msg_terminated_1' }));

    expect(listener.onGap.mock.calls.map(([cursor]) => cursor)).toEqual(['c-9', null]);
    expect(listener.onTerminated).toHaveBeenCalledWith(error, expect.objectContaining({ subscriptionId: 'sub_a' }));
  });

  it.each([
    ['a body that is not JSON', 'not json'],
    ['an occurrence without an eventId', { name: 'x', timestamp: 't', data: {} }],
    ['an unknown envelope', { type: 'surprise' }],
    ['a terminated envelope without an error', { type: 'terminated' }],
  ])('answers %s with 400', async (_label, body) => {
    const receiver = createEventWebhookReceiver({ secrets: [SHARED] });

    await expect(receiver.handle(signed(body))).resolves.toMatchObject({ status: 400 });
  });

  it('answers 500 when the listener throws, and processes the retry', async () => {
    const onEvent = jest.fn().mockRejectedValueOnce(new Error('disk full'));
    const receiver = createEventWebhookReceiver({ secrets: [SHARED], onEvent });

    const failed = await receiver.handle(signed(occurrence));
    const retried = await receiver.handle(signed(occurrence));

    expect([failed.status, retried.status]).toEqual([500, 200]);
    expect(onEvent).toHaveBeenCalledTimes(2);
  });

  it('accepts a rotated secret, stops after release, and says whether it holds secrets', async () => {
    const rotated = generateStandardWebhookSecret();
    const receiver = createEventWebhookReceiver();
    expect(receiver.hasSecrets()).toBe(false);
    const registration = receiver.register({ secret: SHARED });
    registration.bind('sub_a');
    registration.addSecret(rotated);

    const withRotated = await receiver.handle(signed(occurrence, { secret: rotated }));
    registration.release();
    const released = await receiver.handle(signed(occurrence, { secret: rotated, webhookId: 'msg_2' }));
    receiver.addSecret(rotated);

    expect(withRotated.status).toBe(200);
    expect(released.status).toBe(503);
    expect(receiver.hasSecrets()).toBe(true);
  });
});
