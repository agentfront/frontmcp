import {
  generateStandardWebhookSecret,
  signingKeyOf,
  verifyWebhookSignature,
  type OutboundRequest,
  type OutboundResult,
} from '@frontmcp/utils';

import {
  EventCallbackVerifier,
  VERIFICATION_ATTEMPTS_PER_HOST,
  type EventCallbackVerificationRequest,
  type EventCallbackVerifierOptions,
} from '../subscription/event-callback-verifier';

const SECRET = generateStandardWebhookSecret();
const CALLBACK = 'https://hooks.example.com/hooks/mcp?tenant=acme';
const WELL_KNOWN = 'https://hooks.example.com/.well-known/mcp-webhook-receiver.json';
const HOUR_MS = 3_600_000;

type Send = (request: OutboundRequest) => Promise<OutboundResult>;

function answer(status: number, body = '', bodyTruncated = false): OutboundResult {
  return { answered: true, status, body, bodyTruncated, headers: {} };
}

/** A receiver that publishes no well-known document and echoes the challenge it is sent. */
const echoingReceiver: Send = async (request) => {
  if (request.method === 'GET') return answer(404);
  return answer(200, JSON.stringify({ challenge: JSON.parse(request.body ?? '{}').challenge }));
};

function verifierWith(send: Send, overrides: Partial<EventCallbackVerifierOptions> = {}) {
  const sent = jest.fn(send);
  const verifier = new EventCallbackVerifier({
    allowedCallbacks: [],
    allowLocal: false,
    cacheTtlMs: HOUR_MS,
    timeoutMs: 5000,
    send: sent,
    ...overrides,
  });
  return { verifier, sent };
}

function verification(overrides: Partial<EventCallbackVerificationRequest> = {}): EventCallbackVerificationRequest {
  return { principalKey: 'principal:ada', url: CALLBACK, secret: SECRET, subscriptionId: 'sub_0001', ...overrides };
}

describe('EventCallbackVerifier', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('accepts a callback under a configured prefix without sending anything', async () => {
    const { verifier, sent } = verifierWith(echoingReceiver, {
      allowedCallbacks: ['https://hooks.example.com/hooks/'],
    });

    await expect(verifier.verify(verification())).resolves.toMatchObject({ outcome: 'verified' });
    expect(sent).not.toHaveBeenCalled();
  });

  it.each([
    ['the origin alone', 'https://hooks.example.com', 'https://hooks.example.com/hooks/mcp'],
    ['a path without a trailing slash', 'https://hooks.example.com/hooks', 'https://hooks.example.com/hooks/mcp'],
    ['the callback itself', 'https://hooks.example.com/hooks/mcp', 'https://hooks.example.com/hooks/mcp?tenant=acme'],
  ])('accepts a callback under %s', async (_case, prefix, url) => {
    const { verifier, sent } = verifierWith(echoingReceiver, { allowedCallbacks: [prefix] });

    await expect(verifier.verify(verification({ url }))).resolves.toMatchObject({ outcome: 'verified' });
    expect(sent).not.toHaveBeenCalled();
  });

  it.each([
    [
      'a host that only starts with the allowed one',
      'https://hooks.example.com',
      'https://hooks.example.com.attacker.net/x',
    ],
    [
      'a path that only starts with the allowed one',
      'https://hooks.example.com/hooks',
      'https://hooks.example.com/hooks-evil',
    ],
    ['another port', 'https://hooks.example.com', 'https://hooks.example.com:8443/hooks/mcp'],
    ['another scheme', 'https://hooks.example.com', 'http://hooks.example.com/hooks/mcp'],
    ['a prefix that is not a URL', 'hooks.example.com', 'https://hooks.example.com/hooks/mcp'],
  ])('does not treat %s as allowed, and verifies it by request', async (_case, prefix, url) => {
    const { verifier, sent } = verifierWith(echoingReceiver, { allowedCallbacks: [prefix] });

    await expect(verifier.verify(verification({ url }))).resolves.toMatchObject({ outcome: 'verified' });
    expect(sent).toHaveBeenCalled();
  });

  it('accepts a callback its origin declares in the well-known document, without a challenge', async () => {
    const { verifier, sent } = verifierWith(async () => answer(200, JSON.stringify({ receivers: ['/hooks/'] })));

    await expect(verifier.verify(verification())).resolves.toMatchObject({ outcome: 'verified' });
    expect(sent).toHaveBeenCalledTimes(1);
    expect(sent.mock.calls[0][0]).toMatchObject({
      url: WELL_KNOWN,
      method: 'GET',
      timeoutMs: 5000,
      allowLocal: false,
    });
  });

  it('reads the well-known document of an origin once for several callbacks', async () => {
    const { verifier, sent } = verifierWith(async () => answer(200, JSON.stringify({ receivers: ['/hooks/'] })));

    await verifier.verify(verification());
    await verifier.verify(
      verification({ principalKey: 'principal:bob', url: 'https://hooks.example.com/hooks/other' }),
    );

    expect(sent).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a path the document does not cover', answer(200, JSON.stringify({ receivers: ['/other/'] }))],
    ['prefixes that are not absolute paths', answer(200, JSON.stringify({ receivers: ['hooks/', 7] }))],
    ['a document without receivers', answer(200, '{}')],
    ['a document that is not JSON', answer(200, 'receivers: /hooks/')],
    ['a document that is null', answer(200, 'null')],
    ['a document longer than the limit', answer(200, JSON.stringify({ receivers: ['/hooks/'] }), true)],
    ['a missing document', answer(404)],
    ['an unreachable origin', { answered: false, reason: 'connection_refused' } as OutboundResult],
  ])('falls back to the challenge for %s', async (_label, wellKnownAnswer) => {
    const { verifier, sent } = verifierWith(async (request) =>
      request.method === 'GET' ? wellKnownAnswer : echoingReceiver(request),
    );

    await expect(verifier.verify(verification())).resolves.toMatchObject({ outcome: 'verified' });
    expect(sent).toHaveBeenCalledTimes(2);
  });

  it('sends a signed verification envelope with a fresh nonce and the subscription id', async () => {
    const { verifier, sent } = verifierWith(echoingReceiver);

    await verifier.verify(verification());
    await verifier.verify(verification({ principalKey: 'principal:bob' }));

    const first = sent.mock.calls[1][0];
    const second = sent.mock.calls[2][0];
    const headers = first.headers ?? {};
    const envelope = JSON.parse(first.body ?? '');
    expect(first).toMatchObject({ url: CALLBACK, method: 'POST', maxResponseBytes: 4096, allowLocal: false });
    expect(envelope).toEqual({ type: 'verification', challenge: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/) });
    expect(JSON.parse(second.body ?? '').challenge).not.toBe(envelope.challenge);
    expect(headers['content-type']).toBe('application/json');
    expect(headers['X-MCP-Subscription-Id']).toBe('sub_0001');
    expect(headers['webhook-id']).toMatch(/^msg_verification_/);
    const signature = verifyWebhookSignature(
      {
        id: headers['webhook-id'],
        timestamp: headers['webhook-timestamp'],
        signature: headers['webhook-signature'],
        body: first.body ?? '',
      },
      [signingKeyOf(SECRET)],
    );
    expect(signature).toBe('valid');
  });

  it.each([
    ['another challenge', answer(200, JSON.stringify({ challenge: 'not-the-nonce' })), 'challenge_failed'],
    ['a challenge of another length', answer(200, JSON.stringify({ challenge: 'x' })), 'challenge_failed'],
    ['no challenge', answer(200, '{}'), 'challenge_failed'],
    ['a body that is not JSON', answer(200, 'ok'), 'challenge_failed'],
    ['a truncated body', answer(200, '{"challenge":"', true), 'challenge_failed'],
    ['a 4xx', answer(404), 'http_4xx'],
    ['a 5xx', answer(503), 'http_5xx'],
    ['a redirect', answer(302), 'http_4xx'],
    ['a refused connection', { answered: false, reason: 'connection_refused' }, 'connection_refused'],
    ['a forbidden address', { answered: false, reason: 'forbidden_address' }, 'connection_refused'],
    ['a timeout', { answered: false, reason: 'timeout' }, 'timeout'],
    ['a TLS failure', { answered: false, reason: 'tls_error' }, 'tls_error'],
  ])('fails on %s with the category alone', async (_label, challengeAnswer, reason) => {
    const { verifier } = verifierWith(async (request) =>
      request.method === 'GET' ? answer(404) : (challengeAnswer as OutboundResult),
    );

    await expect(verifier.verify(verification())).resolves.toEqual({ outcome: 'failed', reason });
  });

  it('verifies a caller and a callback once within the cache lifetime', async () => {
    jest.useFakeTimers({ now: 1_800_000_000_000 });
    const { verifier, sent } = verifierWith(echoingReceiver);

    const first = await verifier.verify(verification());
    jest.advanceTimersByTime(HOUR_MS - 1);
    const second = await verifier.verify(verification({ subscriptionId: 'sub_0002' }));

    expect(second).toEqual(first);
    expect(sent).toHaveBeenCalledTimes(2);

    jest.advanceTimersByTime(2);
    await verifier.verify(verification());
    expect(sent).toHaveBeenCalledTimes(4);
  });

  it('does not let one caller ride on the proof of another', async () => {
    const { verifier, sent } = verifierWith(echoingReceiver);

    await verifier.verify(verification());
    await verifier.verify(verification({ principalKey: 'principal:eve' }));

    expect(sent.mock.calls.filter(([request]) => request.method === 'POST')).toHaveLength(2);
  });

  it('trusts a recent proof stored on the subscription, and not an old one', async () => {
    const { verifier, sent } = verifierWith(echoingReceiver);
    const recently = Date.now() - 1000;

    await expect(verifier.verify(verification({ verifiedAt: recently }))).resolves.toEqual({
      outcome: 'verified',
      verifiedAt: recently,
    });
    expect(sent).not.toHaveBeenCalled();

    await verifier.verify(verification({ principalKey: 'principal:bob', verifiedAt: Date.now() - 2 * HOUR_MS }));
    expect(sent).toHaveBeenCalled();
  });

  it('does not cache a failed verification', async () => {
    let fails = true;
    const { verifier } = verifierWith(async (request) => {
      if (request.method === 'GET') return answer(404);
      return fails ? answer(500) : echoingReceiver(request);
    });

    await expect(verifier.verify(verification())).resolves.toMatchObject({ outcome: 'failed' });
    fails = false;
    await expect(verifier.verify(verification())).resolves.toMatchObject({ outcome: 'verified' });
  });

  it('limits the verification attempts one host receives in a minute', async () => {
    jest.useFakeTimers({ now: 1_800_000_000_000 });
    const { verifier, sent } = verifierWith(async () => answer(500));
    const attempt = (index: number) => verifier.verify(verification({ principalKey: `principal:user-${index}` }));

    for (let index = 0; index < VERIFICATION_ATTEMPTS_PER_HOST; index++) {
      await expect(attempt(index)).resolves.toMatchObject({ outcome: 'failed' });
    }
    const sentBeforeLimit = sent.mock.calls.length;

    await expect(attempt(99)).resolves.toEqual({ outcome: 'limited', max: VERIFICATION_ATTEMPTS_PER_HOST });
    expect(sent).toHaveBeenCalledTimes(sentBeforeLimit);

    jest.advanceTimersByTime(60_001);
    await expect(attempt(100)).resolves.toMatchObject({ outcome: 'failed' });
  });

  it('counts every port of one host against the same limit', async () => {
    jest.useFakeTimers({ now: 1_800_000_000_000 });
    const { verifier } = verifierWith(async () => answer(500));
    const attemptOnPort = (port: number) =>
      verifier.verify(
        verification({ principalKey: `principal:user-${port}`, url: `https://hooks.example.com:${port}/hooks` }),
      );

    for (let port = 1; port <= VERIFICATION_ATTEMPTS_PER_HOST; port++) {
      await expect(attemptOnPort(port)).resolves.toMatchObject({ outcome: 'failed' });
    }

    await expect(attemptOnPort(9999)).resolves.toEqual({ outcome: 'limited', max: VERIFICATION_ATTEMPTS_PER_HOST });
  });

  it('limits a host to the attempts maxAttemptsPerHost allows instead', async () => {
    jest.useFakeTimers({ now: 1_800_000_000_000 });
    const { verifier, sent } = verifierWith(async () => answer(500), { maxAttemptsPerHost: 2 });
    const attempt = (index: number) => verifier.verify(verification({ principalKey: `principal:user-${index}` }));

    await expect(attempt(1)).resolves.toMatchObject({ outcome: 'failed' });
    await expect(attempt(2)).resolves.toMatchObject({ outcome: 'failed' });
    const sentBeforeLimit = sent.mock.calls.length;

    await expect(attempt(3)).resolves.toEqual({ outcome: 'limited', max: 2 });
    expect(sent).toHaveBeenCalledTimes(sentBeforeLimit);
  });

  it('passes the test option for local callbacks to every request', async () => {
    const { verifier, sent } = verifierWith(echoingReceiver, { allowLocal: true });

    await verifier.verify(verification({ url: 'http://127.0.0.1:8080/hooks/mcp' }));

    expect(sent.mock.calls.map(([request]) => request.allowLocal)).toEqual([true, true]);
    expect(sent.mock.calls[0][0].url).toBe('http://127.0.0.1:8080/.well-known/mcp-webhook-receiver.json');
  });

  it('sends through the hardened request when no sender is given', async () => {
    const verifier = new EventCallbackVerifier({
      allowedCallbacks: [],
      allowLocal: false,
      cacheTtlMs: HOUR_MS,
      timeoutMs: 1000,
    });

    const result = await verifier.verify(verification({ url: 'https://127.0.0.1/hooks/mcp' }));

    expect(result).toEqual({ outcome: 'failed', reason: 'connection_refused' });
  });

  it('keeps its caches bounded, dropping the oldest entry first', async () => {
    const { verifier, sent } = verifierWith(async () => answer(200, JSON.stringify({ receivers: ['/hooks/'] })));

    for (let index = 0; index <= 5000; index++) {
      await verifier.verify(verification({ url: `https://host-${index}.example.com/hooks/mcp` }));
    }
    sent.mockClear();
    await verifier.verify(verification({ principalKey: 'principal:bob', url: 'https://host-0.example.com/hooks/mcp' }));
    await verifier.verify(
      verification({ principalKey: 'principal:bob', url: 'https://host-5000.example.com/hooks/mcp' }),
    );

    expect(sent.mock.calls.map(([request]) => request.url)).toEqual([
      'https://host-0.example.com/.well-known/mcp-webhook-receiver.json',
    ]);
  });
});
