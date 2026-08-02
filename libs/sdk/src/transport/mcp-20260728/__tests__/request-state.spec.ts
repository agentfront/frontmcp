import { hmacSha256 } from '@frontmcp/utils';

import { resolvePrincipal } from '../dispatcher';
import {
  computeRequestBinding,
  decodeRequestState,
  encodeRequestState,
  getRequestStateKey,
  MAX_REQUEST_STATE_BYTES,
  resetRequestStateKey,
  type RequestStateBinding,
} from '../request-state';

const BINDING: RequestStateBinding = {
  principal: 'user-1',
  binding: computeRequestBinding('tools/call', { name: 'confirm', arguments: { action: 'deploy' } }),
};

const RESPONSES = { 'elicitation-1': { action: 'accept', content: { confirmed: true } } };

describe('computeRequestBinding', () => {
  it('is stable for the same salient params', () => {
    expect(computeRequestBinding('tools/call', { name: 'a', arguments: { x: 1 } })).toBe(
      computeRequestBinding('tools/call', { name: 'a', arguments: { x: 1 } }),
    );
  });

  it('ignores fields that legitimately change between the ask and the retry', () => {
    // `_meta`, `inputResponses` and `requestState` all differ on the retry — if
    // they were bound, no retry could ever verify.
    const initial = computeRequestBinding('tools/call', { name: 'a', arguments: { x: 1 } });
    const retry = computeRequestBinding('tools/call', {
      name: 'a',
      arguments: { x: 1 },
      _meta: { anything: true },
      inputResponses: RESPONSES,
      requestState: 'blob',
    });
    expect(retry).toBe(initial);
  });

  it('differs across methods, names and arguments', () => {
    const base = computeRequestBinding('tools/call', { name: 'a', arguments: { x: 1 } });
    expect(computeRequestBinding('prompts/get', { name: 'a', arguments: { x: 1 } })).not.toBe(base);
    expect(computeRequestBinding('tools/call', { name: 'b', arguments: { x: 1 } })).not.toBe(base);
    expect(computeRequestBinding('tools/call', { name: 'a', arguments: { x: 2 } })).not.toBe(base);
  });

  it('handles absent params', () => {
    expect(typeof computeRequestBinding('tools/list', undefined)).toBe('string');
  });
});

describe('requestState integrity', () => {
  it('round-trips a verified blob', () => {
    const state = encodeRequestState(RESPONSES, BINDING);
    expect(decodeRequestState(state, BINDING)).toEqual({ ok: true, responses: RESPONSES });
  });

  it('reports an absent state', () => {
    expect(decodeRequestState(undefined, BINDING)).toEqual({ ok: false, reason: 'absent' });
    expect(decodeRequestState('', BINDING)).toEqual({ ok: false, reason: 'absent' });
    expect(decodeRequestState(42, BINDING)).toEqual({ ok: false, reason: 'absent' });
  });

  it('rejects a blob with no signature', () => {
    expect(decodeRequestState('justsomething', BINDING)).toEqual({ ok: false, reason: 'malformed' });
  });

  it('rejects a tampered payload', () => {
    // The whole point: a client that rewrites the answers must not be believed.
    const state = encodeRequestState(RESPONSES, BINDING);
    const forged = Buffer.from(
      JSON.stringify({ r: { 'elicitation-1': { action: 'accept', content: { confirmed: true, admin: true } } } }),
      'utf8',
    ).toString('base64url');
    const tampered = `${forged}.${state.slice(state.lastIndexOf('.') + 1)}`;

    expect(decodeRequestState(tampered, BINDING)).toEqual({ ok: false, reason: 'bad-signature' });
  });

  it('rejects a tampered signature', () => {
    const state = encodeRequestState(RESPONSES, BINDING);
    expect(decodeRequestState(`${state.slice(0, state.lastIndexOf('.'))}.deadbeef`, BINDING)).toEqual({
      ok: false,
      reason: 'bad-signature',
    });
  });

  it('rejects state presented by a different principal', () => {
    const state = encodeRequestState(RESPONSES, BINDING);
    expect(decodeRequestState(state, { ...BINDING, principal: 'attacker' })).toEqual({
      ok: false,
      reason: 'principal-mismatch',
    });
  });

  it('rejects state replayed onto a different request', () => {
    const state = encodeRequestState(RESPONSES, BINDING);
    expect(
      decodeRequestState(state, { ...BINDING, binding: computeRequestBinding('tools/call', { name: 'other' }) }),
    ).toEqual({ ok: false, reason: 'request-mismatch' });
  });

  it('rejects expired state', () => {
    const state = encodeRequestState(RESPONSES, BINDING, -1);
    expect(decodeRequestState(state, BINDING)).toEqual({ ok: false, reason: 'expired' });
  });

  it('rejects a signed blob whose payload is not JSON', () => {
    // Signed by us, so the signature passes — the payload check must still catch it.
    const body = Buffer.from('not json', 'utf8').toString('base64url');
    const mac = Buffer.from(hmacSha256(getRequestStateKey(), new TextEncoder().encode(body))).toString('base64url');
    expect(decodeRequestState(`${body}.${mac}`, BINDING)).toEqual({ ok: false, reason: 'malformed' });
  });
});

describe('getRequestStateKey', () => {
  const originalVault = process.env['VAULT_SECRET'];
  const originalJwt = process.env['JWT_SECRET'];

  afterEach(() => {
    if (originalVault === undefined) delete process.env['VAULT_SECRET'];
    else process.env['VAULT_SECRET'] = originalVault;
    if (originalJwt === undefined) delete process.env['JWT_SECRET'];
    else process.env['JWT_SECRET'] = originalJwt;
    resetRequestStateKey();
  });

  it('derives from VAULT_SECRET when present', () => {
    resetRequestStateKey();
    process.env['VAULT_SECRET'] = 'vault-pepper';
    expect(Buffer.from(getRequestStateKey()).toString('utf8')).toBe('vault-pepper');
  });

  it('falls back to JWT_SECRET', () => {
    resetRequestStateKey();
    delete process.env['VAULT_SECRET'];
    process.env['JWT_SECRET'] = 'jwt-pepper';
    expect(Buffer.from(getRequestStateKey()).toString('utf8')).toBe('jwt-pepper');
  });

  it('falls back to a random per-process key', () => {
    resetRequestStateKey();
    delete process.env['VAULT_SECRET'];
    delete process.env['JWT_SECRET'];
    const key = getRequestStateKey();
    expect(key.length).toBe(32);
    // Cached, so repeated reads within a process agree — otherwise a retry
    // could never verify state minted moments earlier.
    expect(getRequestStateKey()).toBe(key);
  });
});

describe('resolvePrincipal (token collision)', () => {
  it('distinguishes tokens that share a long prefix', () => {
    // Every HS256 JWT begins with the same base64url-encoded header, so a
    // truncating principal would map unrelated callers onto one identity and
    // let them redeem each other's requestState.
    const header = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9';
    const a = `${header}.payload-one.sig-one`;
    const b = `${header}.payload-two.sig-two`;

    expect(a.slice(0, 16)).toBe(b.slice(0, 16));
    expect(resolvePrincipal({ token: a })).not.toBe(resolvePrincipal({ token: b }));
  });

  it('prefers a verified clientId over the token', () => {
    expect(resolvePrincipal({ clientId: 'user-1', token: 'anything' })).toBe('user-1');
  });

  it('falls back to anonymous with neither', () => {
    expect(resolvePrincipal({})).toBe('anonymous');
    expect(resolvePrincipal(undefined)).toBe('anonymous');
  });

  it('binds requestState to the hashed token, so a different token cannot redeem it', () => {
    const header = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9';
    const binding = computeRequestBinding('tools/call', { name: 'confirm' });

    const minted = encodeRequestState(RESPONSES, {
      principal: resolvePrincipal({ token: `${header}.a.a` }),
      binding,
    });

    expect(decodeRequestState(minted, { principal: resolvePrincipal({ token: `${header}.b.b` }), binding })).toEqual({
      ok: false,
      reason: 'principal-mismatch',
    });
  });
});

describe('requestState size limit', () => {
  it('rejects an oversized blob without hashing it', () => {
    // Bounded before the HMAC so a hostile client cannot burn CPU at will.
    const oversized = 'a'.repeat(MAX_REQUEST_STATE_BYTES + 1);
    expect(decodeRequestState(oversized, BINDING)).toEqual({ ok: false, reason: 'malformed' });
  });

  it('still accepts a legitimate blob under the limit', () => {
    const state = encodeRequestState(RESPONSES, BINDING);
    expect(state.length).toBeLessThan(MAX_REQUEST_STATE_BYTES);
    expect(decodeRequestState(state, BINDING)).toEqual({ ok: true, responses: RESPONSES });
  });
});
