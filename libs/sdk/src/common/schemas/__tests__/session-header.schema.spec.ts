import { mcpSessionHeaderSchema, validateMcpSessionHeader } from '../session-header.schema';

describe('mcpSessionHeaderSchema', () => {
  describe('valid inputs', () => {
    it('should accept simple session ID', () => {
      expect(mcpSessionHeaderSchema.safeParse('abc123').success).toBe(true);
    });

    it('should accept base64url encrypted session ID', () => {
      const encrypted = 'dGVzdC1lbmNyeXB0ZWQtc2Vzc2lvbi1pZA.tag123.ciphertext456';
      expect(mcpSessionHeaderSchema.safeParse(encrypted).success).toBe(true);
    });

    it('should accept max-length session ID (2048 chars)', () => {
      const maxLength = 'a'.repeat(2048);
      expect(mcpSessionHeaderSchema.safeParse(maxLength).success).toBe(true);
    });

    it('should accept space in middle (0x20 is printable)', () => {
      expect(mcpSessionHeaderSchema.safeParse('abc def').success).toBe(true);
    });

    it('should accept all printable ASCII chars (excluding leading/trailing space)', () => {
      // Build string of all printable ASCII (0x21-0x7E) — skip leading space for trim check
      let printable = '';
      for (let i = 0x21; i <= 0x7e; i++) {
        printable += String.fromCharCode(i);
      }
      // Space in the middle is fine
      printable = printable.slice(0, 10) + ' ' + printable.slice(10);
      expect(mcpSessionHeaderSchema.safeParse(printable).success).toBe(true);
    });
  });

  describe('invalid inputs', () => {
    it('should reject empty string', () => {
      expect(mcpSessionHeaderSchema.safeParse('').success).toBe(false);
    });

    it('should reject string exceeding 2048 chars', () => {
      const tooLong = 'a'.repeat(2049);
      expect(mcpSessionHeaderSchema.safeParse(tooLong).success).toBe(false);
    });

    it('should reject null byte (0x00)', () => {
      expect(mcpSessionHeaderSchema.safeParse('abc\x00def').success).toBe(false);
    });

    it('should reject newline (0x0A)', () => {
      expect(mcpSessionHeaderSchema.safeParse('abc\ndef').success).toBe(false);
    });

    it('should reject carriage return (0x0D)', () => {
      expect(mcpSessionHeaderSchema.safeParse('abc\rdef').success).toBe(false);
    });

    it('should reject tab character (0x09)', () => {
      expect(mcpSessionHeaderSchema.safeParse('abc\tdef').success).toBe(false);
    });

    it('should reject DEL character (0x7F)', () => {
      expect(mcpSessionHeaderSchema.safeParse('abc\x7Fdef').success).toBe(false);
    });

    it('should reject non-ASCII unicode', () => {
      expect(mcpSessionHeaderSchema.safeParse('abc\u0100def').success).toBe(false);
    });

    it('should reject leading whitespace', () => {
      expect(mcpSessionHeaderSchema.safeParse(' abc').success).toBe(false);
    });

    it('should reject trailing whitespace', () => {
      expect(mcpSessionHeaderSchema.safeParse('abc ').success).toBe(false);
    });

    it('should reject non-string types', () => {
      expect(mcpSessionHeaderSchema.safeParse(123).success).toBe(false);
      expect(mcpSessionHeaderSchema.safeParse(null).success).toBe(false);
      expect(mcpSessionHeaderSchema.safeParse(undefined).success).toBe(false);
    });
  });
});

describe('validateMcpSessionHeader', () => {
  it('should return undefined for undefined input', () => {
    expect(validateMcpSessionHeader(undefined)).toBeUndefined();
  });

  it('should return undefined for empty string', () => {
    expect(validateMcpSessionHeader('')).toBeUndefined();
  });

  it('should return undefined for invalid input (control chars)', () => {
    expect(validateMcpSessionHeader('abc\x00def')).toBeUndefined();
  });

  it('should return undefined for invalid input (too long)', () => {
    expect(validateMcpSessionHeader('a'.repeat(2049))).toBeUndefined();
  });

  it('should return the validated string for valid input', () => {
    expect(validateMcpSessionHeader('valid-session-id')).toBe('valid-session-id');
  });

  it('should return the validated string for complex encrypted ID', () => {
    const encrypted = 'iv123.tag456.ciphertext789-base64url';
    expect(validateMcpSessionHeader(encrypted)).toBe(encrypted);
  });
});
