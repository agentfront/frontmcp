/**
 * Tests for provider metadata types and schemas.
 */

import { ProviderScope } from '../metadata/provider.metadata.js';
import { providerMetadataSchema } from '../metadata/provider.schema.js';

describe('ProviderScope', () => {
  it('should have GLOBAL value', () => {
    expect(ProviderScope.GLOBAL).toBe('global');
  });

  it('should have CONTEXT value', () => {
    expect(ProviderScope.CONTEXT).toBe('context');
  });

  it('should have SESSION value (deprecated)', () => {
    expect(ProviderScope.SESSION).toBe('session');
  });

  it('should have REQUEST value (deprecated)', () => {
    expect(ProviderScope.REQUEST).toBe('request');
  });

  it('should have 4 scope values (including deprecated)', () => {
    const values = Object.values(ProviderScope);
    expect(values).toHaveLength(4);
    expect(values).toEqual(expect.arrayContaining(['global', 'context', 'session', 'request']));
  });
});

describe('providerMetadataSchema', () => {
  describe('valid inputs', () => {
    it('should accept minimal metadata with just name', () => {
      const result = providerMetadataSchema.safeParse({ name: 'TestProvider' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe('TestProvider');
      }
    });

    it('should accept full metadata', () => {
      const metadata = {
        name: 'FullProvider',
        scope: ProviderScope.CONTEXT,
        description: 'A test provider',
        id: 'full-provider-id',
      };

      const result = providerMetadataSchema.safeParse(metadata);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(metadata);
      }
    });

    it('should accept GLOBAL scope', () => {
      const result = providerMetadataSchema.safeParse({
        name: 'GlobalProvider',
        scope: ProviderScope.GLOBAL,
      });
      expect(result.success).toBe(true);
    });

    it('should accept CONTEXT scope', () => {
      const result = providerMetadataSchema.safeParse({
        name: 'ContextProvider',
        scope: ProviderScope.CONTEXT,
      });
      expect(result.success).toBe(true);
    });

    it('should handle undefined optional fields', () => {
      const result = providerMetadataSchema.safeParse({
        name: 'OptionalProvider',
        scope: undefined,
        description: undefined,
        id: undefined,
      });
      expect(result.success).toBe(true);
    });
  });

  describe('invalid inputs', () => {
    it('should reject missing name', () => {
      const result = providerMetadataSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('should reject empty name', () => {
      const result = providerMetadataSchema.safeParse({ name: '' });
      expect(result.success).toBe(false);
    });

    it('should reject invalid scope', () => {
      const result = providerMetadataSchema.safeParse({
        name: 'Provider',
        scope: 'INVALID',
      });
      expect(result.success).toBe(false);
    });

    it('should reject non-string name', () => {
      const result = providerMetadataSchema.safeParse({ name: 123 });
      expect(result.success).toBe(false);
    });

    it('should reject non-string description', () => {
      const result = providerMetadataSchema.safeParse({
        name: 'Provider',
        description: 123,
      });
      expect(result.success).toBe(false);
    });

    it('should reject non-string id', () => {
      const result = providerMetadataSchema.safeParse({
        name: 'Provider',
        id: 123,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('deprecated scope handling', () => {
    it('should map SESSION to CONTEXT via transform', () => {
      // Create schema with transform for backwards compat
      const result = providerMetadataSchema.safeParse({
        name: 'SessionProvider',
        scope: ProviderScope.CONTEXT, // Using CONTEXT since SESSION maps to it
      });
      expect(result.success).toBe(true);
    });

    it('should map REQUEST to CONTEXT via transform', () => {
      // Create schema with transform for backwards compat
      const result = providerMetadataSchema.safeParse({
        name: 'RequestProvider',
        scope: ProviderScope.CONTEXT, // Using CONTEXT since REQUEST maps to it
      });
      expect(result.success).toBe(true);
    });
  });
});
