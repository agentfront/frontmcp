/**
 * Authorization ID Utils Tests
 *
 * Tests for deriving deterministic authorization IDs from JWT tokens.
 */
import { deriveAuthorizationId } from '../authorization-id.utils';

// Mock @frontmcp/utils sha256Hex
jest.mock('@frontmcp/utils', () => ({
  sha256Hex: jest.fn((input: string) => {
    // Deterministic mock: simple hash simulation based on input
    // Use a simple mapping so we can test determinism and different inputs
    const hashMap: Record<string, string> = {
      signature123: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
      signatureXYZ: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      'full.token.value': 'aaaa111122223333aaaa111122223333aaaa111122223333aaaa111122223333',
      'whole-opaque-token': 'bbbb444455556666bbbb444455556666bbbb444455556666bbbb444455556666',
      differentSig: 'ccccddddeeee0000ccccddddeeee0000ccccddddeeee0000ccccddddeeee0000',
    };
    return hashMap[input] ?? `ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00`;
  }),
}));

describe('deriveAuthorizationId', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return a 16-character hex string', () => {
    const result = deriveAuthorizationId('header.payload.signature123');
    expect(result).toHaveLength(16);
    expect(result).toMatch(/^[0-9a-f]{16}$/);
  });

  it('should be deterministic (same token yields same ID)', () => {
    const id1 = deriveAuthorizationId('header.payload.signature123');
    const id2 = deriveAuthorizationId('header.payload.signature123');
    expect(id1).toBe(id2);
  });

  it('should produce different IDs for different tokens', () => {
    const id1 = deriveAuthorizationId('header.payload.signature123');
    const id2 = deriveAuthorizationId('header.payload.signatureXYZ');
    expect(id1).not.toBe(id2);
  });

  it('should use the signature (third part) for JWT tokens', () => {
    const { sha256Hex } = require('@frontmcp/utils');
    deriveAuthorizationId('header.payload.signature123');
    expect(sha256Hex).toHaveBeenCalledWith('signature123');
  });

  it('should use the whole token when it is not a JWT (no dots)', () => {
    const { sha256Hex } = require('@frontmcp/utils');
    deriveAuthorizationId('whole-opaque-token');
    expect(sha256Hex).toHaveBeenCalledWith('whole-opaque-token');
  });

  it('should use the whole token when signature part is empty (token ends with dot)', () => {
    const { sha256Hex } = require('@frontmcp/utils');
    // parts[2] is empty string, which is falsy, so falls back to whole token
    const token = 'header.payload.';
    deriveAuthorizationId(token);
    // parts[2] is '' which is falsy, so the fallback is the full token
    expect(sha256Hex).toHaveBeenCalledWith(token);
  });

  it('should handle JWT with only two parts (no signature)', () => {
    const { sha256Hex } = require('@frontmcp/utils');
    const token = 'header.payload';
    deriveAuthorizationId(token);
    // parts[2] is undefined, fallback to full token
    expect(sha256Hex).toHaveBeenCalledWith(token);
  });

  it('should extract first 16 characters of the hash', () => {
    const result = deriveAuthorizationId('header.payload.signature123');
    // Our mock returns 'abcdef0123456789...' for 'signature123'
    expect(result).toBe('abcdef0123456789');
  });

  it('should handle tokens with more than 3 dot-separated parts', () => {
    const { sha256Hex } = require('@frontmcp/utils');
    // split('.') on 'a.b.c.d' gives ['a', 'b', 'c.d'] -- no, it gives ['a','b','c','d']
    // parts[2] = 'c' which is truthy
    deriveAuthorizationId('a.b.c.d');
    expect(sha256Hex).toHaveBeenCalledWith('c');
  });
});
