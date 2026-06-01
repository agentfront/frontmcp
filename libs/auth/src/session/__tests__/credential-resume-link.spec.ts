/**
 * Credential resume-link signing Tests (Checkpoint 3b)
 *
 * Asserts the framework-signed mid-session connect token:
 *   - round-trips { sub, key, context } through sign → verify
 *   - is rejected on a wrong secret (HMAC mismatch, constant-time verify)
 *   - is rejected after expiry (short TTL enforced)
 *   - is rejected when tampered
 *   - buildCredentialResumeUrl produces a /oauth/connect URL with the token
 */

import {
  buildCredentialResumeUrl,
  signCredentialResumeToken,
  verifyCredentialResumeToken,
} from '../credential-resume-link';

const SECRET = 'server-signing-secret-32-bytes-minimum';

describe('credential resume-link', () => {
  it('round-trips sub/key/context through sign → verify', () => {
    const token = signCredentialResumeToken({ sub: 'user-1', key: 'acme', context: 'resource-42' }, SECRET);
    const payload = verifyCredentialResumeToken(token, SECRET);
    expect(payload).toBeTruthy();
    expect(payload?.sub).toBe('user-1');
    expect(payload?.key).toBe('acme');
    expect(payload?.context).toBe('resource-42');
    expect(typeof payload?.exp).toBe('number');
  });

  it('omits context when not provided', () => {
    const token = signCredentialResumeToken({ sub: 'user-1', key: 'acme' }, SECRET);
    const payload = verifyCredentialResumeToken(token, SECRET);
    expect(payload?.context).toBeUndefined();
  });

  it('rejects a token signed with a different secret', () => {
    const token = signCredentialResumeToken({ sub: 'user-1', key: 'acme' }, SECRET);
    expect(verifyCredentialResumeToken(token, 'a-totally-different-secret')).toBeNull();
  });

  it('rejects an expired token', () => {
    const token = signCredentialResumeToken({ sub: 'user-1', key: 'acme', ttlMs: 1000 }, SECRET);
    // Valid now …
    expect(verifyCredentialResumeToken(token, SECRET, Date.now())).toBeTruthy();
    // … expired 2s later.
    expect(verifyCredentialResumeToken(token, SECRET, Date.now() + 2000)).toBeNull();
  });

  it('rejects a tampered token', () => {
    const token = signCredentialResumeToken({ sub: 'user-1', key: 'acme' }, SECRET);
    // Flip the inner JSON's sub by decoding, mutating, re-encoding (sig now invalid).
    const json = JSON.parse(Buffer.from(token, 'base64url').toString('utf8')) as { data: { sub: string }; sig: string };
    json.data.sub = 'attacker';
    const tampered = Buffer.from(JSON.stringify(json), 'utf8').toString('base64url');
    expect(verifyCredentialResumeToken(tampered, SECRET)).toBeNull();
  });

  it('rejects malformed/garbage tokens', () => {
    expect(verifyCredentialResumeToken('not-a-valid-token', SECRET)).toBeNull();
    expect(verifyCredentialResumeToken('', SECRET)).toBeNull();
  });

  it('rejects a validly-signed token whose payload has the wrong shape', () => {
    // Sign a payload missing the required string fields, then verify it back.
    // verifyData passes (signature is valid) but the shape guard must reject it.
    const { signData } = require('@frontmcp/utils') as typeof import('@frontmcp/utils');
    const badJson = signData({ sub: 123, key: null, exp: 'soon' }, { secret: SECRET });
    const token = Buffer.from(badJson, 'utf8').toString('base64url');
    expect(verifyCredentialResumeToken(token, SECRET)).toBeNull();
  });

  it('builds a /oauth/connect URL carrying the token', () => {
    const token = signCredentialResumeToken({ sub: 'user-1', key: 'acme' }, SECRET);
    const url = buildCredentialResumeUrl('https://host/mcp', token);
    expect(url.startsWith('https://host/mcp/oauth/connect?token=')).toBe(true);
    // Token is URL-encoded.
    const parsed = new URL(url);
    expect(parsed.searchParams.get('token')).toBe(token);
  });

  it('normalizes a trailing slash on the base path', () => {
    const token = signCredentialResumeToken({ sub: 'user-1', key: 'acme' }, SECRET);
    const url = buildCredentialResumeUrl('https://host/mcp/', token);
    expect(url.startsWith('https://host/mcp/oauth/connect?token=')).toBe(true);
  });
});
