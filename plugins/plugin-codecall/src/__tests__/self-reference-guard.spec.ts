/**
 * Tests for self-reference-guard.ts
 */

import { isBlockedSelfReference, assertNotSelfReference, getBlockedPatterns } from '../security/self-reference-guard';
import { SelfReferenceError } from '../errors/tool-call.errors';

describe('isBlockedSelfReference', () => {
  describe('prefix-based blocking', () => {
    it('should block codecall:search', () => {
      expect(isBlockedSelfReference('codecall:search')).toBe(true);
    });

    it('should block codecall:describe', () => {
      expect(isBlockedSelfReference('codecall:describe')).toBe(true);
    });

    it('should block codecall:execute', () => {
      expect(isBlockedSelfReference('codecall:execute')).toBe(true);
    });

    it('should block codecall:invoke', () => {
      expect(isBlockedSelfReference('codecall:invoke')).toBe(true);
    });

    it('should block any codecall: prefixed tool', () => {
      expect(isBlockedSelfReference('codecall:custom-tool')).toBe(true);
      expect(isBlockedSelfReference('codecall:new-feature')).toBe(true);
      expect(isBlockedSelfReference('codecall:anything')).toBe(true);
    });

    it('should be case-insensitive', () => {
      expect(isBlockedSelfReference('CODECALL:search')).toBe(true);
      expect(isBlockedSelfReference('CodeCall:Execute')).toBe(true);
      expect(isBlockedSelfReference('CODECALL:INVOKE')).toBe(true);
    });

    it('should trim whitespace', () => {
      expect(isBlockedSelfReference('  codecall:search  ')).toBe(true);
      expect(isBlockedSelfReference('\tcodecall:execute\n')).toBe(true);
    });
  });

  describe('non-blocked tools', () => {
    it('should not block regular tools', () => {
      expect(isBlockedSelfReference('users:get')).toBe(false);
      expect(isBlockedSelfReference('orders:list')).toBe(false);
      expect(isBlockedSelfReference('products:create')).toBe(false);
    });

    it('should not block tools with "codecall" in the name but not prefix', () => {
      expect(isBlockedSelfReference('myapp:codecall')).toBe(false);
      expect(isBlockedSelfReference('tools:codecall-helper')).toBe(false);
    });

    it('should not block empty strings', () => {
      expect(isBlockedSelfReference('')).toBe(false);
    });

    it('should not block tools with similar prefixes', () => {
      expect(isBlockedSelfReference('codec:transform')).toBe(false);
      expect(isBlockedSelfReference('code:analyze')).toBe(false);
    });
  });
});

describe('assertNotSelfReference', () => {
  describe('blocked tools', () => {
    it('should throw SelfReferenceError for codecall:execute', () => {
      expect(() => assertNotSelfReference('codecall:execute')).toThrow(SelfReferenceError);
    });

    it('should throw SelfReferenceError for codecall:search', () => {
      expect(() => assertNotSelfReference('codecall:search')).toThrow(SelfReferenceError);
    });

    it('should throw SelfReferenceError for codecall:describe', () => {
      expect(() => assertNotSelfReference('codecall:describe')).toThrow(SelfReferenceError);
    });

    it('should throw SelfReferenceError for codecall:invoke', () => {
      expect(() => assertNotSelfReference('codecall:invoke')).toThrow(SelfReferenceError);
    });

    it('should include tool name in error', () => {
      try {
        assertNotSelfReference('codecall:execute');
        fail('Expected SelfReferenceError to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(SelfReferenceError);
        expect((error as SelfReferenceError).toolName).toBe('codecall:execute');
      }
    });
  });

  describe('allowed tools', () => {
    it('should not throw for regular tools', () => {
      expect(() => assertNotSelfReference('users:get')).not.toThrow();
      expect(() => assertNotSelfReference('orders:create')).not.toThrow();
      expect(() => assertNotSelfReference('admin:settings')).not.toThrow();
    });

    it('should not throw for empty tool name', () => {
      expect(() => assertNotSelfReference('')).not.toThrow();
    });
  });
});

describe('getBlockedPatterns', () => {
  it('should return the codecall prefix', () => {
    const patterns = getBlockedPatterns();
    expect(patterns.prefix).toBe('codecall:');
  });

  it('should return explicit blocked tools', () => {
    const patterns = getBlockedPatterns();
    expect(patterns.explicit).toContain('codecall:search');
    expect(patterns.explicit).toContain('codecall:describe');
    expect(patterns.explicit).toContain('codecall:execute');
    expect(patterns.explicit).toContain('codecall:invoke');
  });

  it('should return exactly 4 explicit blocked tools', () => {
    const patterns = getBlockedPatterns();
    expect(patterns.explicit).toHaveLength(4);
  });

  it('should return readonly explicit array', () => {
    const patterns = getBlockedPatterns();
    expect(Array.isArray(patterns.explicit)).toBe(true);
    // The return type is readonly string[] (TypeScript compile-time check)
    // At runtime, it's a fresh array from Array.from() each call
    const patterns2 = getBlockedPatterns();
    expect(patterns.explicit).not.toBe(patterns2.explicit); // Different array instances
  });
});
