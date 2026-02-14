/**
 * Token Refresh Tests
 *
 * Tests for toEpochSeconds, isSoonExpiring, isSoonExpiringProvider, tryJwtExp.
 */

const mockBase64urlDecode = jest.fn();

jest.mock('@frontmcp/utils', () => ({
  ...jest.requireActual('@frontmcp/utils'),
  base64urlDecode: (input: string) => mockBase64urlDecode(input),
}));

import { toEpochSeconds, isSoonExpiring, isSoonExpiringProvider, tryJwtExp } from '../token.refresh';
import type { ProviderSnapshot } from '../session.types';

describe('token.refresh', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // -----------------------------------------------------------------------
  // toEpochSeconds
  // -----------------------------------------------------------------------
  describe('toEpochSeconds', () => {
    it('should return undefined for undefined input', () => {
      expect(toEpochSeconds(undefined)).toBeUndefined();
    });

    it('should return undefined for null input', () => {
      expect(toEpochSeconds(null as unknown as undefined)).toBeUndefined();
    });

    it('should convert Date to epoch seconds', () => {
      const date = new Date('2024-01-01T00:00:00Z');
      const expected = Math.floor(date.getTime() / 1000);
      expect(toEpochSeconds(date)).toBe(expected);
    });

    it('should divide millisecond values (> 1e12) to seconds', () => {
      const msValue = 1700000000000; // > 1e12, so it's milliseconds
      expect(toEpochSeconds(msValue)).toBe(Math.floor(msValue / 1000));
    });

    it('should keep seconds value (< 1e12) as-is', () => {
      const secValue = 1700000000; // < 1e12, already seconds
      expect(toEpochSeconds(secValue)).toBe(1700000000);
    });

    it('should floor fractional second values', () => {
      expect(toEpochSeconds(1700000000.7)).toBe(1700000000);
    });

    it('should floor fractional millisecond values', () => {
      const ms = 1700000000999.5; // > 1e12
      expect(toEpochSeconds(ms)).toBe(Math.floor(ms / 1000));
    });

    it('should handle Date at epoch', () => {
      const date = new Date(0);
      expect(toEpochSeconds(date)).toBe(0);
    });

    it('should handle zero as seconds value', () => {
      expect(toEpochSeconds(0)).toBe(0);
    });

    it('should treat value exactly at 1e12 boundary as seconds (not ms)', () => {
      // 1e12 is NOT greater than 1e12, so treated as seconds
      expect(toEpochSeconds(1e12)).toBe(Math.floor(1e12));
    });

    it('should treat value just above 1e12 as milliseconds', () => {
      const val = 1e12 + 1;
      expect(toEpochSeconds(val)).toBe(Math.floor(val / 1000));
    });
  });

  // -----------------------------------------------------------------------
  // isSoonExpiring
  // -----------------------------------------------------------------------
  describe('isSoonExpiring', () => {
    it('should return false for undefined exp', () => {
      expect(isSoonExpiring(undefined)).toBe(false);
    });

    it('should return false for expiry far in the future', () => {
      const farFuture = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
      expect(isSoonExpiring(farFuture)).toBe(false);
    });

    it('should return true for expiry in the past', () => {
      const past = Math.floor(Date.now() / 1000) - 100;
      expect(isSoonExpiring(past)).toBe(true);
    });

    it('should return true when expiry is within default skew (60s)', () => {
      const soonExp = Math.floor(Date.now() / 1000) + 30; // 30s from now, within 60s skew
      expect(isSoonExpiring(soonExp)).toBe(true);
    });

    it('should return false when expiry is beyond default skew (60s)', () => {
      const laterExp = Math.floor(Date.now() / 1000) + 120; // 120s from now, beyond 60s
      expect(isSoonExpiring(laterExp)).toBe(false);
    });

    it('should respect custom skewSec', () => {
      const now = Math.floor(Date.now() / 1000);
      const exp = now + 50; // 50s from now

      expect(isSoonExpiring(exp, 30)).toBe(false); // 50 > 30 skew
      expect(isSoonExpiring(exp, 60)).toBe(true); // 50 <= 60 skew
    });

    it('should handle negative skew (treated as 0)', () => {
      const now = Math.floor(Date.now() / 1000);
      // negative skew is clamped to 0 via Math.max(0, skewSec)
      expect(isSoonExpiring(now + 10, -100)).toBe(false);
    });

    it('should handle Date input via toEpochSeconds', () => {
      const past = new Date(Date.now() - 120000); // 2 minutes ago
      expect(isSoonExpiring(past)).toBe(true);
    });

    it('should return true when exp equals now + skew exactly (boundary)', () => {
      const now = Math.floor(Date.now() / 1000);
      // expSec <= now + skewSec  => now + 60 <= now + 60 => true
      expect(isSoonExpiring(now + 60, 60)).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // isSoonExpiringProvider
  // -----------------------------------------------------------------------
  describe('isSoonExpiringProvider', () => {
    function makeSessionLike(providers: Record<string, Partial<ProviderSnapshot>>) {
      const authorizedProviders: Record<string, ProviderSnapshot> = {};
      for (const [id, snap] of Object.entries(providers)) {
        authorizedProviders[id] = {
          id,
          embedMode: 'plain',
          ...snap,
        } as ProviderSnapshot;
      }
      return { authorizedProviders };
    }

    it('should return false when provider is not in snapshot', () => {
      const session = makeSessionLike({});
      expect(isSoonExpiringProvider(session, 'unknown-provider')).toBe(false);
    });

    it('should return false when provider has no exp', () => {
      const session = makeSessionLike({ github: {} });
      expect(isSoonExpiringProvider(session, 'github')).toBe(false);
    });

    it('should return true when provider token is soon expiring', () => {
      const soonExp = Math.floor(Date.now() / 1000) + 10; // 10s from now, within 60s skew
      const session = makeSessionLike({ github: { exp: soonExp } });
      expect(isSoonExpiringProvider(session, 'github')).toBe(true);
    });

    it('should return false when provider token is not soon expiring', () => {
      const farExp = Math.floor(Date.now() / 1000) + 3600;
      const session = makeSessionLike({ github: { exp: farExp } });
      expect(isSoonExpiringProvider(session, 'github')).toBe(false);
    });

    it('should respect custom skewSec', () => {
      const now = Math.floor(Date.now() / 1000);
      const exp = now + 45;
      const session = makeSessionLike({ github: { exp } });

      expect(isSoonExpiringProvider(session, 'github', 30)).toBe(false);
      expect(isSoonExpiringProvider(session, 'github', 60)).toBe(true);
    });

    it('should handle multiple providers independently', () => {
      const now = Math.floor(Date.now() / 1000);
      const session = makeSessionLike({
        github: { exp: now + 10 }, // soon
        google: { exp: now + 3600 }, // not soon
      });

      expect(isSoonExpiringProvider(session, 'github')).toBe(true);
      expect(isSoonExpiringProvider(session, 'google')).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // tryJwtExp
  // -----------------------------------------------------------------------
  describe('tryJwtExp', () => {
    it('should return undefined for undefined token', () => {
      expect(tryJwtExp(undefined)).toBeUndefined();
    });

    it('should return undefined for empty string', () => {
      expect(tryJwtExp('')).toBeUndefined();
    });

    it('should return undefined for token with less than 2 parts', () => {
      expect(tryJwtExp('single-part')).toBeUndefined();
    });

    it('should extract exp from valid JWT payload', () => {
      const payload = { sub: 'user1', exp: 1700000000 };
      const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
      mockBase64urlDecode.mockReturnValue(payloadBytes);

      const result = tryJwtExp('header.payload.signature');

      expect(result).toBe(1700000000);
      expect(mockBase64urlDecode).toHaveBeenCalledWith('payload');
    });

    it('should return undefined when JWT has no exp', () => {
      const payload = { sub: 'user1' };
      const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
      mockBase64urlDecode.mockReturnValue(payloadBytes);

      expect(tryJwtExp('header.payload.signature')).toBeUndefined();
    });

    it('should return undefined when exp is not a number', () => {
      const payload = { sub: 'user1', exp: 'not-a-number' };
      const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
      mockBase64urlDecode.mockReturnValue(payloadBytes);

      expect(tryJwtExp('header.payload.signature')).toBeUndefined();
    });

    it('should return undefined when base64urlDecode throws', () => {
      mockBase64urlDecode.mockImplementation(() => {
        throw new Error('Invalid base64');
      });

      expect(tryJwtExp('header.bad-payload.signature')).toBeUndefined();
    });

    it('should return undefined for non-JSON payload', () => {
      mockBase64urlDecode.mockReturnValue(new TextEncoder().encode('not json'));

      expect(tryJwtExp('header.payload.signature')).toBeUndefined();
    });

    it('should apply toEpochSeconds to exp (ms value > 1e12)', () => {
      const msExp = 1700000000000; // milliseconds
      const payload = { exp: msExp };
      mockBase64urlDecode.mockReturnValue(new TextEncoder().encode(JSON.stringify(payload)));

      const result = tryJwtExp('h.p.s');

      expect(result).toBe(Math.floor(msExp / 1000));
    });

    it('should handle JWT with exactly 2 parts (no signature)', () => {
      // token.split('.') with 2 parts => parts.length < 2 is false, parts[1] exists
      // Actually, "header.payload" has length 2 which is NOT < 2, so it proceeds
      const payload = { exp: 1700000000 };
      mockBase64urlDecode.mockReturnValue(new TextEncoder().encode(JSON.stringify(payload)));

      const result = tryJwtExp('header.payload');

      expect(result).toBe(1700000000);
    });

    it('should handle JWT with 4+ parts gracefully', () => {
      const payload = { exp: 9999999999 };
      mockBase64urlDecode.mockReturnValue(new TextEncoder().encode(JSON.stringify(payload)));

      const result = tryJwtExp('h.p.s.extra');

      expect(result).toBe(9999999999);
    });
  });
});
