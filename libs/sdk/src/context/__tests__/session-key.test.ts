import { SessionKey } from '../session-key.provider';

describe('SessionKey', () => {
  describe('constructor validation', () => {
    it('should reject empty string', () => {
      expect(() => new SessionKey('')).toThrow('SessionKey cannot be empty');
    });

    it('should reject null value', () => {
      expect(() => new SessionKey(null as unknown as string)).toThrow('SessionKey cannot be empty');
    });

    it('should reject undefined value', () => {
      expect(() => new SessionKey(undefined as unknown as string)).toThrow('SessionKey cannot be empty');
    });

    it('should accept single character', () => {
      const key = new SessionKey('a');
      expect(key.value).toBe('a');
    });

    it('should accept exactly 2048 characters', () => {
      const maxLengthKey = 'a'.repeat(2048);
      const key = new SessionKey(maxLengthKey);
      expect(key.value).toBe(maxLengthKey);
      expect(key.value.length).toBe(2048);
    });

    it('should reject 2049 characters', () => {
      const tooLongKey = 'a'.repeat(2049);
      expect(() => new SessionKey(tooLongKey)).toThrow('SessionKey exceeds maximum length of 2048 characters');
    });

    it('should reject special characters (@#$%^&*)', () => {
      const invalidChars = ['@', '#', '$', '%', '^', '&', '*', '!', '?', '+', '='];
      for (const char of invalidChars) {
        expect(() => new SessionKey(`session${char}key`)).toThrow('SessionKey contains invalid characters');
      }
    });

    it('should reject spaces', () => {
      expect(() => new SessionKey('session key')).toThrow('SessionKey contains invalid characters');
    });

    it('should reject newlines', () => {
      expect(() => new SessionKey('session\nkey')).toThrow('SessionKey contains invalid characters');
    });

    it('should reject tabs', () => {
      expect(() => new SessionKey('session\tkey')).toThrow('SessionKey contains invalid characters');
    });

    it('should accept alphanumeric characters', () => {
      const key = new SessionKey('abc123XYZ789');
      expect(key.value).toBe('abc123XYZ789');
    });

    it('should accept hyphens', () => {
      const key = new SessionKey('session-id-123');
      expect(key.value).toBe('session-id-123');
    });

    it('should accept underscores', () => {
      const key = new SessionKey('session_id_123');
      expect(key.value).toBe('session_id_123');
    });

    it('should accept periods', () => {
      const key = new SessionKey('session.id.123');
      expect(key.value).toBe('session.id.123');
    });

    it('should accept colons (for anon:uuid format)', () => {
      const key = new SessionKey('anon:550e8400-e29b-41d4-a716-446655440000');
      expect(key.value).toBe('anon:550e8400-e29b-41d4-a716-446655440000');
    });

    it('should store value property correctly', () => {
      const sessionId = 'user-session-12345';
      const key = new SessionKey(sessionId);
      expect(key.value).toBe(sessionId);
    });
  });

  describe('static validate()', () => {
    it('should validate without constructing', () => {
      // Should not throw for valid key
      expect(() => SessionKey.validate('valid-session-key')).not.toThrow();
    });

    it('should throw for empty string', () => {
      expect(() => SessionKey.validate('')).toThrow('SessionKey cannot be empty');
    });

    it('should throw for too long key', () => {
      expect(() => SessionKey.validate('a'.repeat(2049))).toThrow(
        'SessionKey exceeds maximum length of 2048 characters',
      );
    });

    it('should throw for invalid characters', () => {
      expect(() => SessionKey.validate('invalid@key')).toThrow('SessionKey contains invalid characters');
    });

    it('should accept valid complex key', () => {
      expect(() => SessionKey.validate('anon:user-123_session.v2')).not.toThrow();
    });
  });

  describe('static constants', () => {
    it('should have MAX_LENGTH of 2048', () => {
      expect(SessionKey.MAX_LENGTH).toBe(2048);
    });

    it('should have VALID_PATTERN matching expected characters', () => {
      expect(SessionKey.VALID_PATTERN.test('abc123')).toBe(true);
      expect(SessionKey.VALID_PATTERN.test('a-b_c.d:e')).toBe(true);
      expect(SessionKey.VALID_PATTERN.test('invalid@char')).toBe(false);
      expect(SessionKey.VALID_PATTERN.test('has space')).toBe(false);
    });
  });

  describe('colon edge cases', () => {
    it('should accept multiple consecutive colons', () => {
      const key = new SessionKey('anon::uuid');
      expect(key.value).toBe('anon::uuid');
    });

    it('should accept leading colon', () => {
      const key = new SessionKey(':session-id');
      expect(key.value).toBe(':session-id');
    });

    it('should accept trailing colon', () => {
      const key = new SessionKey('session-id:');
      expect(key.value).toBe('session-id:');
    });
  });
});
