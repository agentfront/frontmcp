import { base64Encode, hmacSha256 } from '@frontmcp/utils';

import { checkSignature, signatureHeaders, signingKeyOf } from '../webhook-signature';

const key = signingKeyOf('a-webhook-secret-of-at-least-32-chars');
const body = JSON.stringify({ codeVerifier: 'x', approved: true });
const NOW = 1_800_000_000_000;

function signed(overrides: Partial<Record<'id' | 'timestamp' | 'signature' | 'body', string>> = {}) {
  const headers = signatureHeaders(key, body, NOW);
  return {
    id: headers['webhook-id'],
    timestamp: headers['webhook-timestamp'],
    signature: headers['webhook-signature'],
    body,
    ...overrides,
  };
}

describe('approval signatures (Standard Webhooks)', () => {
  it('signs `<id>.<timestamp>.<body>` with HMAC-SHA256, base64', () => {
    const headers = signatureHeaders(key, body, NOW);
    const expected = base64Encode(
      hmacSha256(key, new TextEncoder().encode(`${headers['webhook-id']}.${headers['webhook-timestamp']}.${body}`)),
    );

    expect(headers['webhook-id']).toMatch(/^msg_[0-9a-f-]{36}$/);
    expect(headers['webhook-timestamp']).toBe(String(NOW / 1000));
    expect(headers['webhook-signature']).toBe(`v1,${expected}`);
  });

  it('accepts its own signature', () => {
    expect(checkSignature(key, signed(), NOW)).toBe('valid');
  });

  it('accepts a matching signature among several', () => {
    const message = signed();
    expect(checkSignature(key, { ...message, signature: `v1,AAAA ${message.signature}` }, NOW)).toBe('valid');
  });

  it('refuses a message without its id, timestamp or signature', () => {
    expect(checkSignature(key, signed({ id: '' }), NOW)).toBe('missing');
    expect(checkSignature(key, { ...signed(), timestamp: undefined }, NOW)).toBe('missing');
    expect(checkSignature(key, { ...signed(), signature: undefined }, NOW)).toBe('missing');
  });

  it('refuses a timestamp more than five minutes away, or not a number', () => {
    expect(checkSignature(key, signed(), NOW + 301_000)).toBe('stale');
    expect(checkSignature(key, signed(), NOW - 301_000)).toBe('stale');
    expect(checkSignature(key, signed({ timestamp: '1.8e9' }), NOW)).toBe('stale');
  });

  it('refuses a changed body, id or timestamp, another key, and other versions', () => {
    expect(checkSignature(key, signed({ body: `${body} ` }), NOW)).toBe('mismatch');
    expect(checkSignature(key, signed({ id: 'msg_other' }), NOW)).toBe('mismatch');
    expect(checkSignature(key, signed({ timestamp: String(NOW / 1000 + 1) }), NOW)).toBe('mismatch');
    expect(checkSignature(signingKeyOf('another-secret-of-at-least-32-chars'), signed(), NOW)).toBe('mismatch');
    const value = signed().signature.slice('v1,'.length);
    expect(checkSignature(key, signed({ signature: `v1a,${value}` }), NOW)).toBe('mismatch');
    expect(checkSignature(key, signed({ signature: 'v1' }), NOW)).toBe('mismatch');
  });

  it('reads a whsec_ secret as base64, and refuses one that is not', () => {
    expect(signingKeyOf(`whsec_${Buffer.from('abc').toString('base64')}`)).toEqual(new TextEncoder().encode('abc'));
    expect(() => signingKeyOf('whsec_***')).toThrow(TypeError);
  });
});
