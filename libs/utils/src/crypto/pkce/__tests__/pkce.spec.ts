import {
  generateCodeVerifier,
  generateCodeChallenge,
  verifyCodeChallenge,
  generatePkcePair,
  isValidCodeVerifier,
  isValidCodeChallenge,
  PkceError,
  MIN_CODE_VERIFIER_LENGTH,
  MAX_CODE_VERIFIER_LENGTH,
  DEFAULT_CODE_VERIFIER_LENGTH,
} from '../pkce';

describe('PKCE utilities', () => {
  describe('constants', () => {
    it('should have correct minimum length per RFC 7636', () => {
      expect(MIN_CODE_VERIFIER_LENGTH).toBe(43);
    });

    it('should have correct maximum length per RFC 7636', () => {
      expect(MAX_CODE_VERIFIER_LENGTH).toBe(128);
    });

    it('should have sensible default length', () => {
      expect(DEFAULT_CODE_VERIFIER_LENGTH).toBe(64);
      expect(DEFAULT_CODE_VERIFIER_LENGTH).toBeGreaterThanOrEqual(MIN_CODE_VERIFIER_LENGTH);
      expect(DEFAULT_CODE_VERIFIER_LENGTH).toBeLessThanOrEqual(MAX_CODE_VERIFIER_LENGTH);
    });
  });

  describe('generateCodeVerifier', () => {
    it('should generate verifier with default length', () => {
      const verifier = generateCodeVerifier();
      expect(verifier.length).toBe(DEFAULT_CODE_VERIFIER_LENGTH);
    });

    it('should generate verifier with custom length', () => {
      const verifier = generateCodeVerifier(80);
      expect(verifier.length).toBe(80);
    });

    it('should generate verifier with minimum length', () => {
      const verifier = generateCodeVerifier(MIN_CODE_VERIFIER_LENGTH);
      expect(verifier.length).toBe(MIN_CODE_VERIFIER_LENGTH);
    });

    it('should generate verifier with maximum length', () => {
      const verifier = generateCodeVerifier(MAX_CODE_VERIFIER_LENGTH);
      expect(verifier.length).toBe(MAX_CODE_VERIFIER_LENGTH);
    });

    it('should throw PkceError for length below minimum', () => {
      expect(() => generateCodeVerifier(42)).toThrow(PkceError);
      expect(() => generateCodeVerifier(42)).toThrow(/must be between 43 and 128/);
    });

    it('should throw PkceError for length above maximum', () => {
      expect(() => generateCodeVerifier(129)).toThrow(PkceError);
      expect(() => generateCodeVerifier(129)).toThrow(/must be between 43 and 128/);
    });

    it('should throw PkceError for zero length', () => {
      expect(() => generateCodeVerifier(0)).toThrow(PkceError);
    });

    it('should throw PkceError for negative length', () => {
      expect(() => generateCodeVerifier(-1)).toThrow(PkceError);
    });

    it('should generate unique verifiers', () => {
      const verifiers = new Set<string>();
      for (let i = 0; i < 100; i++) {
        verifiers.add(generateCodeVerifier());
      }
      expect(verifiers.size).toBe(100);
    });

    it('should generate base64url-safe characters only', () => {
      const verifier = generateCodeVerifier();
      // base64url uses A-Z, a-z, 0-9, -, _
      expect(verifier).toMatch(/^[A-Za-z0-9\-_]+$/);
    });

    it('should produce valid verifiers per RFC 7636', () => {
      for (let i = 0; i < 10; i++) {
        const verifier = generateCodeVerifier();
        expect(isValidCodeVerifier(verifier)).toBe(true);
      }
    });
  });

  describe('generateCodeChallenge', () => {
    it('should generate challenge from verifier', () => {
      const verifier = generateCodeVerifier();
      const challenge = generateCodeChallenge(verifier);
      expect(challenge).toBeDefined();
      expect(typeof challenge).toBe('string');
    });

    it('should produce 43-character challenge (SHA-256 base64url)', () => {
      const verifier = generateCodeVerifier();
      const challenge = generateCodeChallenge(verifier);
      expect(challenge.length).toBe(43);
    });

    it('should produce base64url-safe characters only', () => {
      const verifier = generateCodeVerifier();
      const challenge = generateCodeChallenge(verifier);
      expect(challenge).toMatch(/^[A-Za-z0-9\-_]+$/);
    });

    it('should produce deterministic output for same input', () => {
      const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
      const challenge1 = generateCodeChallenge(verifier);
      const challenge2 = generateCodeChallenge(verifier);
      expect(challenge1).toBe(challenge2);
    });

    it('should produce different challenges for different verifiers', () => {
      const verifier1 = generateCodeVerifier();
      const verifier2 = generateCodeVerifier();
      const challenge1 = generateCodeChallenge(verifier1);
      const challenge2 = generateCodeChallenge(verifier2);
      expect(challenge1).not.toBe(challenge2);
    });

    it('should match known test vector', () => {
      // Test vector from RFC 7636 Appendix B
      const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
      const challenge = generateCodeChallenge(verifier);
      // Expected: E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM
      expect(challenge).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
    });

    it('should produce valid challenges', () => {
      for (let i = 0; i < 10; i++) {
        const verifier = generateCodeVerifier();
        const challenge = generateCodeChallenge(verifier);
        expect(isValidCodeChallenge(challenge)).toBe(true);
      }
    });
  });

  describe('verifyCodeChallenge', () => {
    it('should verify valid verifier/challenge pair', () => {
      const verifier = generateCodeVerifier();
      const challenge = generateCodeChallenge(verifier);
      expect(verifyCodeChallenge(verifier, challenge)).toBe(true);
    });

    it('should reject invalid verifier', () => {
      const verifier = generateCodeVerifier();
      const challenge = generateCodeChallenge(verifier);
      const wrongVerifier = generateCodeVerifier();
      expect(verifyCodeChallenge(wrongVerifier, challenge)).toBe(false);
    });

    it('should reject tampered challenge', () => {
      const verifier = generateCodeVerifier();
      const challenge = generateCodeChallenge(verifier);
      const tamperedChallenge = challenge.slice(0, -1) + 'X';
      expect(verifyCodeChallenge(verifier, tamperedChallenge)).toBe(false);
    });

    it('should reject empty verifier', () => {
      const verifier = generateCodeVerifier();
      const challenge = generateCodeChallenge(verifier);
      expect(verifyCodeChallenge('', challenge)).toBe(false);
    });

    it('should verify RFC 7636 test vector', () => {
      const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
      const challenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
      expect(verifyCodeChallenge(verifier, challenge)).toBe(true);
    });

    it('should be case-sensitive', () => {
      const verifier = generateCodeVerifier();
      const challenge = generateCodeChallenge(verifier);
      const uppercaseChallenge = challenge.toUpperCase();
      // If challenge was already uppercase or lowercase, skip
      if (challenge !== uppercaseChallenge) {
        expect(verifyCodeChallenge(verifier, uppercaseChallenge)).toBe(false);
      }
    });
  });

  describe('generatePkcePair', () => {
    it('should generate both verifier and challenge', () => {
      const pair = generatePkcePair();
      expect(pair.codeVerifier).toBeDefined();
      expect(pair.codeChallenge).toBeDefined();
    });

    it('should generate verifier with default length', () => {
      const pair = generatePkcePair();
      expect(pair.codeVerifier.length).toBe(DEFAULT_CODE_VERIFIER_LENGTH);
    });

    it('should generate verifier with custom length', () => {
      const pair = generatePkcePair(80);
      expect(pair.codeVerifier.length).toBe(80);
    });

    it('should generate challenge with correct length', () => {
      const pair = generatePkcePair();
      expect(pair.codeChallenge.length).toBe(43);
    });

    it('should generate valid pair that verifies', () => {
      const pair = generatePkcePair();
      expect(verifyCodeChallenge(pair.codeVerifier, pair.codeChallenge)).toBe(true);
    });

    it('should throw for invalid length', () => {
      expect(() => generatePkcePair(42)).toThrow(PkceError);
    });

    it('should generate unique pairs', () => {
      const pairs = [];
      for (let i = 0; i < 10; i++) {
        pairs.push(generatePkcePair());
      }
      const verifiers = new Set(pairs.map((p) => p.codeVerifier));
      const challenges = new Set(pairs.map((p) => p.codeChallenge));
      expect(verifiers.size).toBe(10);
      expect(challenges.size).toBe(10);
    });
  });

  describe('isValidCodeVerifier', () => {
    it('should accept valid verifier', () => {
      const verifier = generateCodeVerifier();
      expect(isValidCodeVerifier(verifier)).toBe(true);
    });

    it('should accept minimum length verifier', () => {
      const verifier = 'a'.repeat(MIN_CODE_VERIFIER_LENGTH);
      expect(isValidCodeVerifier(verifier)).toBe(true);
    });

    it('should accept maximum length verifier', () => {
      const verifier = 'a'.repeat(MAX_CODE_VERIFIER_LENGTH);
      expect(isValidCodeVerifier(verifier)).toBe(true);
    });

    it('should reject too short verifier', () => {
      const verifier = 'a'.repeat(MIN_CODE_VERIFIER_LENGTH - 1);
      expect(isValidCodeVerifier(verifier)).toBe(false);
    });

    it('should reject too long verifier', () => {
      const verifier = 'a'.repeat(MAX_CODE_VERIFIER_LENGTH + 1);
      expect(isValidCodeVerifier(verifier)).toBe(false);
    });

    it('should reject empty string', () => {
      expect(isValidCodeVerifier('')).toBe(false);
    });

    it('should accept all unreserved characters per RFC 7636', () => {
      // RFC 7636: unreserved = ALPHA / DIGIT / "-" / "." / "_" / "~"
      const verifier = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqr0123456789-._~';
      expect(isValidCodeVerifier(verifier)).toBe(true);
    });

    it('should reject reserved characters', () => {
      const baseVerifier = 'a'.repeat(42);
      expect(isValidCodeVerifier(baseVerifier + '!')).toBe(false);
      expect(isValidCodeVerifier(baseVerifier + '@')).toBe(false);
      expect(isValidCodeVerifier(baseVerifier + '#')).toBe(false);
      expect(isValidCodeVerifier(baseVerifier + '$')).toBe(false);
      expect(isValidCodeVerifier(baseVerifier + '%')).toBe(false);
      expect(isValidCodeVerifier(baseVerifier + '/')).toBe(false);
      expect(isValidCodeVerifier(baseVerifier + '+')).toBe(false);
      expect(isValidCodeVerifier(baseVerifier + '=')).toBe(false);
    });

    it('should reject whitespace', () => {
      const baseVerifier = 'a'.repeat(42);
      expect(isValidCodeVerifier(baseVerifier + ' ')).toBe(false);
      expect(isValidCodeVerifier(baseVerifier + '\t')).toBe(false);
      expect(isValidCodeVerifier(baseVerifier + '\n')).toBe(false);
    });
  });

  describe('isValidCodeChallenge', () => {
    it('should accept valid challenge', () => {
      const verifier = generateCodeVerifier();
      const challenge = generateCodeChallenge(verifier);
      expect(isValidCodeChallenge(challenge)).toBe(true);
    });

    it('should accept RFC 7636 test vector challenge', () => {
      expect(isValidCodeChallenge('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')).toBe(true);
    });

    it('should reject too short challenge', () => {
      expect(isValidCodeChallenge('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-c')).toBe(false);
    });

    it('should reject too long challenge', () => {
      expect(isValidCodeChallenge('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cMX')).toBe(false);
    });

    it('should reject empty string', () => {
      expect(isValidCodeChallenge('')).toBe(false);
    });

    it('should reject invalid base64url characters', () => {
      // Valid length but invalid characters
      expect(isValidCodeChallenge('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw+cM')).toBe(false);
      expect(isValidCodeChallenge('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw/cM')).toBe(false);
      expect(isValidCodeChallenge('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw=cM')).toBe(false);
    });

    it('should accept base64url characters', () => {
      // All base64url characters: A-Z, a-z, 0-9, -, _
      const challenge = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijk0123-_';
      expect(challenge.length).toBe(43);
      expect(isValidCodeChallenge(challenge)).toBe(true);
    });
  });

  describe('PkceError', () => {
    it('should have correct name', () => {
      const error = new PkceError('test');
      expect(error.name).toBe('PkceError');
    });

    it('should have correct message', () => {
      const error = new PkceError('test message');
      expect(error.message).toBe('test message');
    });

    it('should be instanceof Error', () => {
      const error = new PkceError('test');
      expect(error).toBeInstanceOf(Error);
    });

    it('should be instanceof PkceError', () => {
      const error = new PkceError('test');
      expect(error).toBeInstanceOf(PkceError);
    });
  });

  describe('integration', () => {
    it('should support complete PKCE flow', () => {
      // 1. Generate PKCE pair
      const { codeVerifier, codeChallenge } = generatePkcePair();

      // 2. Validate both are properly formatted
      expect(isValidCodeVerifier(codeVerifier)).toBe(true);
      expect(isValidCodeChallenge(codeChallenge)).toBe(true);

      // 3. Simulate webhook flow: challenge is sent, verifier comes back
      expect(verifyCodeChallenge(codeVerifier, codeChallenge)).toBe(true);
    });

    it('should detect tampering in flow', () => {
      const { codeVerifier, codeChallenge } = generatePkcePair();

      // Attacker tries to use different verifier
      const attackerVerifier = generateCodeVerifier();
      expect(verifyCodeChallenge(attackerVerifier, codeChallenge)).toBe(false);

      // Attacker tries to tamper with challenge
      const tamperedChallenge = codeChallenge.replace(/-/g, '_').replace(/_/g, '-');
      if (tamperedChallenge !== codeChallenge) {
        expect(verifyCodeChallenge(codeVerifier, tamperedChallenge)).toBe(false);
      }
    });

    it('should work with various verifier lengths', () => {
      const lengths = [43, 50, 64, 80, 100, 128];
      for (const length of lengths) {
        const pair = generatePkcePair(length);
        expect(pair.codeVerifier.length).toBe(length);
        expect(pair.codeChallenge.length).toBe(43);
        expect(verifyCodeChallenge(pair.codeVerifier, pair.codeChallenge)).toBe(true);
      }
    });
  });
});
