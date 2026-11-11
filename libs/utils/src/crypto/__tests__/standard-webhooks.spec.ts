import { createHmac } from 'node:crypto';

import {
  generateStandardWebhookSecret,
  generateWebhookMessageId,
  isStandardWebhookSecret,
  signingKeyOf,
  signWebhookMessage,
  verifyWebhookSignature,
  WEBHOOK_ID_HEADER,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_SIGNATURE_TOLERANCE_SECONDS,
  WEBHOOK_TIMESTAMP_HEADER,
  webhookSignatureHeaders,
} from '../standard-webhooks';

const NOW_SECONDS = 1_800_000_000;
const NOW = NOW_SECONDS * 1000;
const body = JSON.stringify({ eventId: 'evt_1', name: 'incident.created', data: { severity: 'P1', note: 'café ☕' } });
const message = { id: 'msg_2KWPBgLlAfxdpx2AI54pPJ85f4W', timestamp: NOW_SECONDS, body };

const currentSecret = `whsec_${Buffer.alloc(32, 7).toString('base64')}`;
const previousSecret = `whsec_${Buffer.alloc(24, 9).toString('base64')}`;
const currentKey = signingKeyOf(currentSecret);
const previousKey = signingKeyOf(previousSecret);

/** What a Standard Webhooks receiver computes for itself: HMAC-SHA256 with the base64-decoded secret. */
function independentSignature(secret: string, id: string, timestamp: number, payload: string): string {
  const key = Buffer.from(secret.slice('whsec_'.length), 'base64');
  return createHmac('sha256', key).update(`${id}.${timestamp}.${payload}`, 'utf8').digest('base64');
}

function signed(overrides: Partial<Record<'id' | 'timestamp' | 'signature' | 'body', string>> = {}) {
  const headers = webhookSignatureHeaders(message, [currentKey]);
  return {
    id: headers[WEBHOOK_ID_HEADER],
    timestamp: headers[WEBHOOK_TIMESTAMP_HEADER],
    signature: headers[WEBHOOK_SIGNATURE_HEADER],
    body,
    ...overrides,
  };
}

describe('Standard Webhooks constants', () => {
  it('names the three headers and a five minute tolerance', () => {
    expect([WEBHOOK_ID_HEADER, WEBHOOK_TIMESTAMP_HEADER, WEBHOOK_SIGNATURE_HEADER]).toEqual([
      'webhook-id',
      'webhook-timestamp',
      'webhook-signature',
    ]);
    expect(WEBHOOK_SIGNATURE_TOLERANCE_SECONDS).toBe(300);
  });
});

describe('signingKeyOf', () => {
  it('reads a whsec_ secret as base64 after the prefix', () => {
    expect(signingKeyOf(`whsec_${Buffer.from('abc').toString('base64')}`)).toEqual(new TextEncoder().encode('abc'));
  });

  it('reads any other secret as its UTF-8 bytes', () => {
    expect(signingKeyOf('a plain secret é')).toEqual(new TextEncoder().encode('a plain secret é'));
  });

  it('refuses a whsec_ secret that is not base64', () => {
    expect(() => signingKeyOf('whsec_***')).toThrow(new TypeError('not base64'));
    expect(() => signingKeyOf('whsec_')).toThrow(TypeError);
  });

  it('refuses a secret that decodes to an empty key', () => {
    expect(() => signingKeyOf('whsec_A')).toThrow(new TypeError('empty signing key'));
    expect(() => signingKeyOf('')).toThrow(new TypeError('empty signing key'));
  });
});

describe('isStandardWebhookSecret', () => {
  const secretOf = (byteCount: number) => `whsec_${Buffer.alloc(byteCount, 0xa5).toString('base64')}`;

  it.each([24, 25, 26, 32, 63, 64])('accepts whsec_ with base64 of %i bytes', (byteCount) => {
    expect(isStandardWebhookSecret(secretOf(byteCount))).toBe(true);
  });

  it.each([1, 23, 65, 128])('refuses whsec_ with base64 of %i bytes', (byteCount) => {
    expect(isStandardWebhookSecret(secretOf(byteCount))).toBe(false);
  });

  it.each([25, 26, 64])('accepts base64 of %i bytes without its padding', (byteCount) => {
    const unpadded = secretOf(byteCount).replace(/=+$/, '');

    expect(unpadded).not.toContain('=');
    expect(isStandardWebhookSecret(unpadded)).toBe(true);
  });

  it.each([
    ['no prefix', Buffer.alloc(32, 1).toString('base64')],
    ['another prefix', `whsk_${Buffer.alloc(32, 1).toString('base64')}`],
    ['an uppercase prefix', `WHSEC_${Buffer.alloc(32, 1).toString('base64')}`],
    ['nothing after the prefix', 'whsec_'],
    ['base64url characters', `whsec_${'-_'.repeat(16)}`],
    ['a character outside base64', `whsec_${'A'.repeat(31)}*`],
    ['a dangling character', `whsec_${'A'.repeat(33)}`],
    ['too much padding', `whsec_${'A'.repeat(32)}=`],
    ['padding in the middle', `whsec_${'A'.repeat(14)}==${'A'.repeat(16)}`],
    ['surrounding whitespace', ` ${secretOf(32)}`],
    ['a plain passphrase', 'a-webhook-secret-of-at-least-32-chars'],
  ])('refuses %s', (_case, secret) => {
    expect(isStandardWebhookSecret(secret)).toBe(false);
  });

  it('accepts only secrets signingKeyOf can read, with the byte count it reads', () => {
    for (const byteCount of [24, 25, 26, 64]) {
      const unpadded = secretOf(byteCount).replace(/=+$/, '');

      expect(signingKeyOf(secretOf(byteCount))).toHaveLength(byteCount);
      expect(signingKeyOf(unpadded)).toEqual(signingKeyOf(secretOf(byteCount)));
    }
  });
});

describe('generateStandardWebhookSecret', () => {
  it('returns whsec_ with base64 of 32 random bytes', () => {
    const secret = generateStandardWebhookSecret();

    expect(secret).toMatch(/^whsec_[A-Za-z0-9+/]{43}=$/);
    expect(signingKeyOf(secret)).toHaveLength(32);
    expect(isStandardWebhookSecret(secret)).toBe(true);
  });

  it('returns a new secret each time', () => {
    const secrets = new Set(Array.from({ length: 50 }, () => generateStandardWebhookSecret()));

    expect(secrets.size).toBe(50);
  });
});

describe('generateWebhookMessageId', () => {
  it('returns msg_ and 144 random bits, in header-safe characters', () => {
    expect(generateWebhookMessageId()).toMatch(/^msg_[A-Za-z0-9_-]{24}$/);
  });

  it('puts the kind of a control envelope before the random part', () => {
    expect(generateWebhookMessageId('verification')).toMatch(/^msg_verification_[A-Za-z0-9_-]{24}$/);
    expect(generateWebhookMessageId('gap-2_x')).toMatch(/^msg_gap-2_x_[A-Za-z0-9_-]{24}$/);
  });

  it('returns a new id each time', () => {
    const ids = new Set(Array.from({ length: 200 }, () => generateWebhookMessageId()));

    expect(ids.size).toBe(200);
  });

  it.each(['', 'two words', 'dot.ted', 'evt/1', 'line\nbreak', 'é'])('refuses the kind %p', (kind) => {
    expect(() => generateWebhookMessageId(kind)).toThrow(TypeError);
  });
});

describe('signWebhookMessage', () => {
  it('gives the signature of the vector the Standard Webhooks documentation publishes', () => {
    const published = {
      id: 'msg_p5jXN8AQM9LWM0D4loKWxJek',
      timestamp: 1614265330,
      body: '{"test": 2432232314}',
    };
    const key = signingKeyOf('whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw');

    expect(signWebhookMessage(published, [key])).toBe('v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=');
  });

  it('signs `<id>.<timestamp>.<body>` as a receiver computes it from the secret', () => {
    const expected = independentSignature(currentSecret, message.id, message.timestamp, body);

    expect(signWebhookMessage(message, [currentKey])).toBe(`v1,${expected}`);
  });

  it('signs the UTF-8 bytes of a plain secret', () => {
    const plainSecret = 'a-webhook-secret-of-at-least-32-chars';
    const expected = createHmac('sha256', plainSecret).update(`${message.id}.${message.timestamp}.${body}`).digest();

    expect(signWebhookMessage(message, [signingKeyOf(plainSecret)])).toBe(`v1,${expected.toString('base64')}`);
  });

  it('gives one signature per key, in order, separated by a space', () => {
    const current = independentSignature(currentSecret, message.id, message.timestamp, body);
    const previous = independentSignature(previousSecret, message.id, message.timestamp, body);

    expect(signWebhookMessage(message, [currentKey, previousKey])).toBe(`v1,${current} v1,${previous}`);
  });

  it('signs the body as given, without reading it as JSON', () => {
    const spaced = '{ "a" : 1 }';

    expect(signWebhookMessage({ ...message, body: spaced }, [currentKey])).toBe(
      `v1,${independentSignature(currentSecret, message.id, message.timestamp, spaced)}`,
    );
    expect(signWebhookMessage({ ...message, body: '' }, [currentKey])).toBe(
      `v1,${independentSignature(currentSecret, message.id, message.timestamp, '')}`,
    );
  });

  it.each([
    ['no id', { ...message, id: '' }, [currentKey]],
    ['a timestamp in milliseconds', { ...message, timestamp: NOW }, [currentKey]],
    ['a fractional timestamp', { ...message, timestamp: NOW_SECONDS + 0.5 }, [currentKey]],
    ['a negative timestamp', { ...message, timestamp: -1 }, [currentKey]],
    ['a timestamp that is not a number', { ...message, timestamp: Number.NaN }, [currentKey]],
    ['no signing key', message, []],
  ])('refuses %s', (_case, invalidMessage, signingKeys) => {
    expect(() => signWebhookMessage(invalidMessage, signingKeys)).toThrow(TypeError);
  });
});

describe('webhookSignatureHeaders', () => {
  it('returns the id, the timestamp in seconds and the signature', () => {
    expect(webhookSignatureHeaders(message, [currentKey, previousKey])).toEqual({
      'webhook-id': message.id,
      'webhook-timestamp': String(NOW_SECONDS),
      'webhook-signature': signWebhookMessage(message, [currentKey, previousKey]),
    });
  });

  it('keeps the id and changes the timestamp and signature on a retry', () => {
    const first = webhookSignatureHeaders(message, [currentKey]);
    const retry = webhookSignatureHeaders({ ...message, timestamp: NOW_SECONDS + 30 }, [currentKey]);

    expect(retry['webhook-id']).toBe(first['webhook-id']);
    expect(retry['webhook-timestamp']).toBe(String(NOW_SECONDS + 30));
    expect(retry['webhook-signature']).not.toBe(first['webhook-signature']);
  });

  it('refuses what signWebhookMessage refuses', () => {
    expect(() => webhookSignatureHeaders({ ...message, id: '' }, [currentKey])).toThrow(TypeError);
  });
});

describe('verifyWebhookSignature', () => {
  it('accepts its own signature', () => {
    expect(verifyWebhookSignature(signed(), [currentKey], NOW)).toBe('valid');
  });

  it('accepts a signature a receiver-side implementation made', () => {
    const signature = `v1,${independentSignature(currentSecret, message.id, message.timestamp, body)}`;

    expect(verifyWebhookSignature(signed({ signature }), [currentKey], NOW)).toBe('valid');
  });

  it('accepts a matching signature among several in the header', () => {
    const { signature } = signed();

    expect(verifyWebhookSignature(signed({ signature: `v1,AAAA ${signature}` }), [currentKey], NOW)).toBe('valid');
    expect(verifyWebhookSignature(signed({ signature: `v1a,AAAA  ${signature}` }), [currentKey], NOW)).toBe('valid');
  });

  it('accepts a message signed with either secret of a rotation', () => {
    const duringRotation = { ...signed(), signature: signWebhookMessage(message, [currentKey, previousKey]) };
    const withPreviousOnly = { ...signed(), signature: signWebhookMessage(message, [previousKey]) };

    expect(verifyWebhookSignature(duringRotation, [previousKey], NOW)).toBe('valid');
    expect(verifyWebhookSignature(duringRotation, [currentKey], NOW)).toBe('valid');
    expect(verifyWebhookSignature(withPreviousOnly, [currentKey, previousKey], NOW)).toBe('valid');
  });

  it('reports a message without its id, timestamp or signature as missing', () => {
    expect(verifyWebhookSignature(signed({ id: '' }), [currentKey], NOW)).toBe('missing');
    expect(verifyWebhookSignature({ ...signed(), id: undefined }, [currentKey], NOW)).toBe('missing');
    expect(verifyWebhookSignature({ ...signed(), timestamp: undefined }, [currentKey], NOW)).toBe('missing');
    expect(verifyWebhookSignature({ ...signed(), signature: undefined }, [currentKey], NOW)).toBe('missing');
    expect(verifyWebhookSignature({ body }, [currentKey], NOW)).toBe('missing');
  });

  it('reports a timestamp outside the tolerance, or not whole seconds, as stale', () => {
    expect(verifyWebhookSignature(signed(), [currentKey], NOW + 301_000)).toBe('stale');
    expect(verifyWebhookSignature(signed(), [currentKey], NOW - 301_000)).toBe('stale');
    expect(verifyWebhookSignature(signed({ timestamp: '1.8e9' }), [currentKey], NOW)).toBe('stale');
    expect(verifyWebhookSignature(signed({ timestamp: String(NOW) }), [currentKey], NOW)).toBe('stale');
    expect(verifyWebhookSignature(signed({ timestamp: ` ${NOW_SECONDS}` }), [currentKey], NOW)).toBe('stale');
  });

  it('accepts a timestamp at the edge of the tolerance', () => {
    expect(verifyWebhookSignature(signed(), [currentKey], NOW + 300_000)).toBe('valid');
    expect(verifyWebhookSignature(signed(), [currentKey], NOW - 300_000)).toBe('valid');
  });

  it('checks against the current time by default', () => {
    const fresh = { ...message, timestamp: Math.floor(Date.now() / 1000) };
    const headers = webhookSignatureHeaders(fresh, [currentKey]);
    const received = { id: fresh.id, timestamp: headers['webhook-timestamp'], body };

    expect(verifyWebhookSignature({ ...received, signature: headers['webhook-signature'] }, [currentKey])).toBe(
      'valid',
    );
    expect(verifyWebhookSignature(signed({ timestamp: '1700000000' }), [currentKey])).toBe('stale');
  });

  it('reports a changed body, id or timestamp as a mismatch', () => {
    expect(verifyWebhookSignature(signed({ body: `${body} ` }), [currentKey], NOW)).toBe('mismatch');
    expect(verifyWebhookSignature(signed({ id: 'msg_other' }), [currentKey], NOW)).toBe('mismatch');
    expect(verifyWebhookSignature(signed({ timestamp: String(NOW_SECONDS + 1) }), [currentKey], NOW)).toBe('mismatch');
  });

  it('reports another key, or no key, as a mismatch', () => {
    expect(verifyWebhookSignature(signed(), [previousKey], NOW)).toBe('mismatch');
    expect(verifyWebhookSignature(signed(), [], NOW)).toBe('mismatch');
  });

  it('reports other versions and malformed entries as a mismatch', () => {
    const value = signed().signature.slice('v1,'.length);

    expect(verifyWebhookSignature(signed({ signature: `v1a,${value}` }), [currentKey], NOW)).toBe('mismatch');
    expect(verifyWebhookSignature(signed({ signature: `V1,${value}` }), [currentKey], NOW)).toBe('mismatch');
    expect(verifyWebhookSignature(signed({ signature: 'v1' }), [currentKey], NOW)).toBe('mismatch');
    expect(verifyWebhookSignature(signed({ signature: value }), [currentKey], NOW)).toBe('mismatch');
    expect(verifyWebhookSignature(signed({ signature: ' ' }), [currentKey], NOW)).toBe('mismatch');
  });

  it('reports a signature of another length as a mismatch instead of throwing', () => {
    const value = signed().signature.slice('v1,'.length);

    expect(verifyWebhookSignature(signed({ signature: `v1,${value.slice(0, -4)}` }), [currentKey], NOW)).toBe(
      'mismatch',
    );
    expect(verifyWebhookSignature(signed({ signature: `v1,${value}AAAA` }), [currentKey], NOW)).toBe('mismatch');
    expect(verifyWebhookSignature(signed({ signature: 'v1,' }), [currentKey], NOW)).toBe('mismatch');
  });

  it('reports a signature that differs in one character as a mismatch', () => {
    const { signature } = signed();
    const lastCharacter = signature.at(-2) === 'A' ? 'B' : 'A';
    const altered = `${signature.slice(0, -2)}${lastCharacter}=`;

    expect(verifyWebhookSignature(signed({ signature: altered }), [currentKey], NOW)).toBe('mismatch');
  });
});
