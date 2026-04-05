import { z } from 'zod';

// We test the Node.js version directly
import {
  detectRuntimeContext,
  getRuntimeContext,
  resetRuntimeContext,
  isEntryAvailable,
  entryAvailabilitySchema,
} from '../runtime-context';
import type { RuntimeContext, EntryAvailability } from '../runtime-context';

describe('runtime-context', () => {
  afterEach(() => {
    resetRuntimeContext();
  });

  // ---- isEntryAvailable (pure matcher) ----

  describe('isEntryAvailable', () => {
    const ctx: RuntimeContext = {
      platform: 'darwin',
      runtime: 'node',
      deployment: 'standalone',
      env: 'production',
    };

    it('returns true when availability is undefined', () => {
      expect(isEntryAvailable(undefined, ctx)).toBe(true);
    });

    it('returns true when availability is an empty object', () => {
      expect(isEntryAvailable({}, ctx)).toBe(true);
    });

    it('matches a single platform value', () => {
      expect(isEntryAvailable({ platform: ['darwin'] }, ctx)).toBe(true);
    });

    it('rejects a non-matching platform', () => {
      expect(isEntryAvailable({ platform: ['linux'] }, ctx)).toBe(false);
    });

    it('matches with OR within a field (any value matches)', () => {
      expect(isEntryAvailable({ platform: ['linux', 'darwin'] }, ctx)).toBe(true);
    });

    it('matches with AND across fields (all must match)', () => {
      expect(isEntryAvailable({ platform: ['darwin'], runtime: ['node'] }, ctx)).toBe(true);
    });

    it('rejects when one field matches but another does not (AND)', () => {
      expect(isEntryAvailable({ platform: ['darwin'], runtime: ['browser'] }, ctx)).toBe(false);
    });

    it('returns false when a field has an empty array', () => {
      expect(isEntryAvailable({ platform: [] }, ctx)).toBe(false);
    });

    it('matches runtime field', () => {
      expect(isEntryAvailable({ runtime: ['node'] }, ctx)).toBe(true);
      expect(isEntryAvailable({ runtime: ['bun'] }, ctx)).toBe(false);
    });

    it('matches deployment field', () => {
      expect(isEntryAvailable({ deployment: ['standalone'] }, ctx)).toBe(true);
      expect(isEntryAvailable({ deployment: ['serverless'] }, ctx)).toBe(false);
    });

    it('matches env field', () => {
      expect(isEntryAvailable({ env: ['production'] }, ctx)).toBe(true);
      expect(isEntryAvailable({ env: ['development', 'test'] }, ctx)).toBe(false);
    });

    it('handles all four fields at once', () => {
      const full: EntryAvailability = {
        platform: ['darwin', 'linux'],
        runtime: ['node', 'bun'],
        deployment: ['standalone'],
        env: ['production'],
      };
      expect(isEntryAvailable(full, ctx)).toBe(true);
    });

    it('rejects when all four fields are specified but one fails', () => {
      const fail: EntryAvailability = {
        platform: ['darwin'],
        runtime: ['node'],
        deployment: ['standalone'],
        env: ['development'], // mismatch
      };
      expect(isEntryAvailable(fail, ctx)).toBe(false);
    });
  });

  // ---- detectRuntimeContext ----

  describe('detectRuntimeContext', () => {
    it('returns an object with all required fields', () => {
      const ctx = detectRuntimeContext();
      expect(ctx).toHaveProperty('platform');
      expect(ctx).toHaveProperty('runtime');
      expect(ctx).toHaveProperty('deployment');
      expect(ctx).toHaveProperty('env');
    });

    it('platform matches process.platform', () => {
      const ctx = detectRuntimeContext();
      expect(ctx.platform).toBe(process.platform);
    });

    it('runtime is "node" by default', () => {
      const ctx = detectRuntimeContext();
      expect(ctx.runtime).toBe('node');
    });

    it('deployment is "standalone" by default', () => {
      const ctx = detectRuntimeContext();
      expect(ctx.deployment).toBe('standalone');
    });
  });

  // ---- getRuntimeContext (singleton) ----

  describe('getRuntimeContext', () => {
    it('returns the same reference on multiple calls (cached)', () => {
      const a = getRuntimeContext();
      const b = getRuntimeContext();
      expect(a).toBe(b);
    });

    it('returns a fresh object after resetRuntimeContext', () => {
      const a = getRuntimeContext();
      resetRuntimeContext();
      const b = getRuntimeContext();
      expect(a).not.toBe(b);
      // Values should still be equivalent
      expect(a.platform).toBe(b.platform);
    });
  });

  // ---- entryAvailabilitySchema (Zod) ----

  describe('entryAvailabilitySchema', () => {
    it('parses a valid object', () => {
      const input = { platform: ['darwin'], runtime: ['node'] };
      const result = entryAvailabilitySchema.parse(input);
      expect(result).toEqual(input);
    });

    it('parses an empty object', () => {
      const result = entryAvailabilitySchema.parse({});
      expect(result).toEqual({});
    });

    it('allows all fields to be optional', () => {
      const result = entryAvailabilitySchema.parse({ env: ['test'] });
      expect(result).toEqual({ env: ['test'] });
    });

    it('rejects non-string array values', () => {
      expect(() => entryAvailabilitySchema.parse({ platform: 'darwin' })).toThrow();
      expect(() => entryAvailabilitySchema.parse({ platform: [123] })).toThrow();
    });

    it('rejects empty strings in arrays', () => {
      expect(() => entryAvailabilitySchema.parse({ platform: [''] })).toThrow();
    });

    it('rejects unknown fields (strict mode)', () => {
      expect(() => entryAvailabilitySchema.parse({ platform: ['darwin'], unknown: true })).toThrow();
    });
  });
});
