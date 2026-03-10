/**
 * TTL Validation Utilities Tests
 */
import {
  validateTTL,
  validateOptionalTTL,
  ttlToExpiresAt,
  expiresAtToTTL,
  isExpired,
  normalizeTTL,
  MAX_TTL_SECONDS,
} from '../utils/ttl';
import { StorageTTLError } from '../errors';

describe('TTL Validation Utilities', () => {
  describe('validateTTL', () => {
    describe('valid TTL values', () => {
      it('should accept positive integers', () => {
        expect(() => validateTTL(1)).not.toThrow();
        expect(() => validateTTL(60)).not.toThrow();
        expect(() => validateTTL(3600)).not.toThrow();
        expect(() => validateTTL(86400)).not.toThrow();
      });

      it('should accept maximum TTL', () => {
        expect(() => validateTTL(MAX_TTL_SECONDS)).not.toThrow();
      });
    });

    describe('invalid TTL values', () => {
      it('should reject zero', () => {
        expect(() => validateTTL(0)).toThrow(StorageTTLError);
        expect(() => validateTTL(0)).toThrow('must be positive');
      });

      it('should reject negative numbers', () => {
        expect(() => validateTTL(-1)).toThrow(StorageTTLError);
        expect(() => validateTTL(-100)).toThrow(StorageTTLError);
      });

      it('should reject non-integers', () => {
        expect(() => validateTTL(1.5)).toThrow(StorageTTLError);
        expect(() => validateTTL(1.5)).toThrow('must be an integer');
      });

      it('should reject NaN', () => {
        expect(() => validateTTL(NaN)).toThrow(StorageTTLError);
        expect(() => validateTTL(NaN)).toThrow('must be a finite number');
      });

      it('should reject Infinity', () => {
        expect(() => validateTTL(Infinity)).toThrow(StorageTTLError);
        expect(() => validateTTL(-Infinity)).toThrow(StorageTTLError);
      });

      it('should reject values exceeding maximum', () => {
        expect(() => validateTTL(MAX_TTL_SECONDS + 1)).toThrow(StorageTTLError);
        expect(() => validateTTL(MAX_TTL_SECONDS + 1)).toThrow('exceeds maximum');
      });

      it('should reject non-number types', () => {
        expect(() => validateTTL('60' as unknown as number)).toThrow(StorageTTLError);
        expect(() => validateTTL('60' as unknown as number)).toThrow('must be a number');
      });
    });
  });

  describe('validateOptionalTTL', () => {
    it('should accept undefined', () => {
      expect(() => validateOptionalTTL(undefined)).not.toThrow();
    });

    it('should accept valid TTL', () => {
      expect(() => validateOptionalTTL(60)).not.toThrow();
    });

    it('should reject invalid TTL', () => {
      expect(() => validateOptionalTTL(0)).toThrow(StorageTTLError);
      expect(() => validateOptionalTTL(-1)).toThrow(StorageTTLError);
    });
  });

  describe('ttlToExpiresAt', () => {
    it('should calculate expiration timestamp correctly', () => {
      const before = Date.now();
      const expiresAt = ttlToExpiresAt(60);
      const after = Date.now();

      // Should be approximately 60 seconds in the future
      expect(expiresAt).toBeGreaterThanOrEqual(before + 60000);
      expect(expiresAt).toBeLessThanOrEqual(after + 60000);
    });

    it('should handle small TTL values', () => {
      const expiresAt = ttlToExpiresAt(1);
      expect(expiresAt).toBeGreaterThan(Date.now());
      expect(expiresAt).toBeLessThanOrEqual(Date.now() + 1000 + 10); // +10ms buffer
    });

    it('should handle large TTL values', () => {
      const expiresAt = ttlToExpiresAt(86400); // 1 day
      const expectedMin = Date.now() + 86400 * 1000 - 100;
      const expectedMax = Date.now() + 86400 * 1000 + 100;
      expect(expiresAt).toBeGreaterThanOrEqual(expectedMin);
      expect(expiresAt).toBeLessThanOrEqual(expectedMax);
    });
  });

  describe('expiresAtToTTL', () => {
    it('should calculate remaining TTL correctly', () => {
      const expiresAt = Date.now() + 60000; // 60 seconds from now
      const ttl = expiresAtToTTL(expiresAt);
      expect(ttl).toBeGreaterThanOrEqual(59);
      expect(ttl).toBeLessThanOrEqual(60);
    });

    it('should return 0 for expired timestamps', () => {
      const expiresAt = Date.now() - 1000; // 1 second ago
      expect(expiresAtToTTL(expiresAt)).toBe(0);
    });

    it('should return 0 for current timestamp', () => {
      const expiresAt = Date.now();
      expect(expiresAtToTTL(expiresAt)).toBe(0);
    });

    it('should round up to next second', () => {
      const expiresAt = Date.now() + 1500; // 1.5 seconds from now
      const ttl = expiresAtToTTL(expiresAt);
      expect(ttl).toBe(2); // Rounded up
    });
  });

  describe('isExpired', () => {
    it('should return false for undefined', () => {
      expect(isExpired(undefined)).toBe(false);
    });

    it('should return false for future timestamps', () => {
      expect(isExpired(Date.now() + 60000)).toBe(false);
    });

    it('should return true for past timestamps', () => {
      expect(isExpired(Date.now() - 1000)).toBe(true);
    });

    it('should return true for current timestamp', () => {
      // Create a timestamp that's definitely in the past by time we check
      const past = Date.now() - 1;
      expect(isExpired(past)).toBe(true);
    });
  });

  describe('normalizeTTL', () => {
    it('should return seconds unchanged when unit is seconds', () => {
      expect(normalizeTTL(60, 'seconds')).toBe(60);
      expect(normalizeTTL(3600, 'seconds')).toBe(3600);
    });

    it('should convert milliseconds to seconds', () => {
      expect(normalizeTTL(60000, 'milliseconds')).toBe(60);
      expect(normalizeTTL(3600000, 'milliseconds')).toBe(3600);
    });

    it('should round up when converting milliseconds', () => {
      expect(normalizeTTL(1500, 'milliseconds')).toBe(2); // 1.5s -> 2s
      expect(normalizeTTL(1001, 'milliseconds')).toBe(2); // 1.001s -> 2s
      expect(normalizeTTL(1000, 'milliseconds')).toBe(1); // 1s -> 1s
    });

    it('should handle edge cases', () => {
      expect(normalizeTTL(1, 'milliseconds')).toBe(1); // 0.001s -> 1s (ceil)
      expect(normalizeTTL(999, 'milliseconds')).toBe(1); // 0.999s -> 1s
    });
  });
});
