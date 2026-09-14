/**
 * Unit tests for incremental-authorization ticket signing (GHSA-2c4g-9c8x-6m8g).
 *
 * The ticket is the ONLY thing that authorizes `/oauth/authorize` to skip the
 * login step, so the negative cases here are the security contract: a forged,
 * tampered, expired, or wrong-secret ticket must verify as `null` and leave the
 * caller on the ordinary login path.
 */
import {
  DEFAULT_INCREMENTAL_TICKET_TTL_MS,
  signIncrementalAuthTicket,
  verifyIncrementalAuthTicket,
} from '../incremental-auth-ticket';

const SECRET = 'unit-test-signing-secret';

describe('signIncrementalAuthTicket / verifyIncrementalAuthTicket', () => {
  it('round-trips the signed payload', () => {
    const token = signIncrementalAuthTicket({ sub: 'user-1', appId: 'Tasks', toolId: 'Tasks:create' }, SECRET);
    const payload = verifyIncrementalAuthTicket(token, SECRET);

    expect(payload).not.toBeNull();
    expect(payload?.sub).toBe('user-1');
    expect(payload?.appId).toBe('Tasks');
    expect(payload?.toolId).toBe('Tasks:create');
    expect(typeof payload?.jti).toBe('string');
  });

  it('carries prior app ids forward', () => {
    const token = signIncrementalAuthTicket({ sub: 'u', appId: 'B', priorAppIds: ['A'] }, SECRET);
    expect(verifyIncrementalAuthTicket(token, SECRET)?.priorAppIds).toEqual(['A']);
  });

  it('mints a distinct jti per ticket so each can be claimed once', () => {
    const first = verifyIncrementalAuthTicket(signIncrementalAuthTicket({ sub: 'u', appId: 'B' }, SECRET), SECRET);
    const second = verifyIncrementalAuthTicket(signIncrementalAuthTicket({ sub: 'u', appId: 'B' }, SECRET), SECRET);

    expect(first?.jti).not.toBe(second?.jti);
  });

  it('defaults to the documented TTL', () => {
    const before = Date.now();
    const payload = verifyIncrementalAuthTicket(signIncrementalAuthTicket({ sub: 'u', appId: 'B' }, SECRET), SECRET);

    expect(payload!.exp).toBeGreaterThanOrEqual(before + DEFAULT_INCREMENTAL_TICKET_TTL_MS - 1000);
    expect(payload!.exp).toBeLessThanOrEqual(Date.now() + DEFAULT_INCREMENTAL_TICKET_TTL_MS);
  });

  it('rejects a ticket signed with a different secret', () => {
    const token = signIncrementalAuthTicket({ sub: 'u', appId: 'B' }, SECRET);
    expect(verifyIncrementalAuthTicket(token, 'other-secret')).toBeNull();
  });

  it('rejects a tampered subject', () => {
    const token = signIncrementalAuthTicket({ sub: 'victim', appId: 'B' }, SECRET);
    const decoded = JSON.parse(Buffer.from(token, 'base64url').toString('utf8')) as {
      data: { sub: string };
    };
    decoded.data.sub = 'attacker';
    const forged = Buffer.from(JSON.stringify(decoded), 'utf8').toString('base64url');

    expect(verifyIncrementalAuthTicket(forged, SECRET)).toBeNull();
  });

  it('rejects an expired ticket', () => {
    const token = signIncrementalAuthTicket({ sub: 'u', appId: 'B', ttlMs: 1000 }, SECRET);
    expect(verifyIncrementalAuthTicket(token, SECRET, Date.now() + 5000)).toBeNull();
  });

  it('rejects garbage, empty, and non-base64url input', () => {
    expect(verifyIncrementalAuthTicket('', SECRET)).toBeNull();
    expect(verifyIncrementalAuthTicket('not-a-ticket', SECRET)).toBeNull();
    expect(verifyIncrementalAuthTicket('{}', SECRET)).toBeNull();
  });

  it('rejects a correctly-signed payload whose shape is wrong', () => {
    // An attacker with the secret is out of scope, but a malformed payload from
    // an older/newer format must not be accepted as a valid identity claim.
    const { signData } = require('@frontmcp/utils') as typeof import('@frontmcp/utils');
    const encode = (payload: unknown): string =>
      Buffer.from(signData(payload, { secret: SECRET }), 'utf8').toString('base64url');

    expect(verifyIncrementalAuthTicket(encode({ appId: 'B', jti: 'j', exp: Date.now() + 1000 }), SECRET)).toBeNull();
    expect(
      verifyIncrementalAuthTicket(encode({ sub: '', appId: 'B', jti: 'j', exp: Date.now() + 1000 }), SECRET),
    ).toBeNull();
    expect(verifyIncrementalAuthTicket(encode({ sub: 'u', jti: 'j', exp: Date.now() + 1000 }), SECRET)).toBeNull();
    expect(verifyIncrementalAuthTicket(encode({ sub: 'u', appId: 'B', exp: Date.now() + 1000 }), SECRET)).toBeNull();
    expect(verifyIncrementalAuthTicket(encode({ sub: 'u', appId: 'B', jti: 'j', exp: 'soon' }), SECRET)).toBeNull();
    expect(verifyIncrementalAuthTicket(encode({ sub: 'u', appId: 'B', jti: 'j', exp: Number.NaN }), SECRET)).toBeNull();
    expect(
      verifyIncrementalAuthTicket(
        encode({ sub: 'u', appId: 'B', jti: 'j', exp: Date.now() + 1000, priorAppIds: [1] }),
        SECRET,
      ),
    ).toBeNull();
  });
});
