/**
 * Consent enforcement utilities — getConsentedToolIds / isToolConsented.
 *
 * These back the runtime consent check in the call-tool flow:
 * - a token with an ENABLED `consent` claim yields the selected-tool set,
 * - a token with NO consent metadata yields `undefined` (⇒ allow-all default),
 * - `isToolConsented` allows when there is no set, and otherwise requires the
 *   tool id (by any of its candidate names) to be a member.
 */
import 'reflect-metadata';

import { SignJWT } from 'jose';

import { getConsentedToolIds, isToolConsented } from '../consent.utils';

/** Mint an unsigned-ish JWT (HS256 with a throwaway key) carrying `claims`. */
async function makeToken(claims: Record<string, unknown>): Promise<string> {
  const secret = new TextEncoder().encode('test-secret-test-secret-test-secret-1234');
  return new SignJWT(claims).setProtectedHeader({ alg: 'HS256', typ: 'JWT' }).setIssuedAt().sign(secret);
}

describe('getConsentedToolIds', () => {
  it('returns undefined when authInfo is undefined', () => {
    expect(getConsentedToolIds(undefined)).toBeUndefined();
  });

  it('returns undefined when there is no consent metadata anywhere (consent disabled)', () => {
    expect(getConsentedToolIds({ extra: { user: { sub: 'u1' } } } as any)).toBeUndefined();
    expect(getConsentedToolIds({ user: { sub: 'u1' } } as any)).toBeUndefined();
  });

  it('returns undefined when a consent claim is present but not enabled', () => {
    const info = { extra: { user: { consent: { enabled: false, selectedTools: ['a'] } } } } as any;
    expect(getConsentedToolIds(info)).toBeUndefined();
  });

  it('reads the selected-tool set from extra.user.consent (HTTP request flow shape)', () => {
    const info = { extra: { user: { consent: { enabled: true, selectedTools: ['notes:create', 'notes:list'] } } } };
    const set = getConsentedToolIds(info as any);
    expect(set).toBeDefined();
    expect([...set!].sort()).toEqual(['notes:create', 'notes:list']);
  });

  it('reads the selected-tool set from a top-level user.consent (alt transport shape)', () => {
    const info = { user: { consent: { enabled: true, selectedTools: ['only:one'] } } };
    expect([...getConsentedToolIds(info as any)!]).toEqual(['only:one']);
  });

  it('returns an EMPTY set (not undefined) when consent is enabled with zero selected tools', () => {
    const info = { extra: { user: { consent: { enabled: true, selectedTools: [] } } } };
    const set = getConsentedToolIds(info as any);
    expect(set).toBeDefined();
    expect(set!.size).toBe(0);
  });

  it('decodes the consent claim from the verified token when not projected onto authInfo', async () => {
    const token = await makeToken({ sub: 'u1', consent: { enabled: true, selectedTools: ['from:token'] } });
    const set = getConsentedToolIds({ token } as any);
    expect([...set!]).toEqual(['from:token']);
  });

  it('returns undefined for a token with no consent claim', async () => {
    const token = await makeToken({ sub: 'u1', scope: 'read' });
    expect(getConsentedToolIds({ token } as any)).toBeUndefined();
  });

  it('ignores non-string entries in selectedTools', () => {
    const info = { extra: { user: { consent: { enabled: true, selectedTools: ['ok', 123, null, 'ok2'] } } } };
    expect([...getConsentedToolIds(info as any)!].sort()).toEqual(['ok', 'ok2']);
  });
});

describe('isToolConsented', () => {
  it('allows any tool when the consented set is undefined (consent disabled)', () => {
    expect(isToolConsented(undefined, 'anything')).toBe(true);
    expect(isToolConsented(undefined, 'notes:create', 'create')).toBe(true);
  });

  it('allows a tool whose id is in the set', () => {
    const set = new Set(['notes:create']);
    expect(isToolConsented(set, 'notes:create')).toBe(true);
  });

  it('allows when ANY candidate id matches (fullName OR bare name)', () => {
    const set = new Set(['notes:create']);
    // bare name not in set, fullName is
    expect(isToolConsented(set, 'create', 'notes:create')).toBe(true);
  });

  it('rejects a tool absent from a non-empty set', () => {
    const set = new Set(['notes:create']);
    expect(isToolConsented(set, 'notes:delete', 'delete')).toBe(false);
  });

  it('rejects ALL tools when the set is empty (consent enabled, nothing selected)', () => {
    const set = new Set<string>();
    expect(isToolConsented(set, 'notes:create')).toBe(false);
  });

  it('ignores undefined candidate ids', () => {
    const set = new Set(['notes:create']);
    expect(isToolConsented(set, undefined, 'notes:create')).toBe(true);
    expect(isToolConsented(set, undefined, undefined)).toBe(false);
  });
});
