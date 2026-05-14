/**
 * Tests for `httpOptionsSchema` (issue #410 — body limit option).
 */

import { httpOptionsSchema } from '../schema';

describe('httpOptionsSchema', () => {
  describe('bodyLimit (issue #410)', () => {
    it('defaults to "4mb" when omitted (no longer body-parser\'s silent 100KB)', () => {
      const parsed = httpOptionsSchema.parse({});
      expect(parsed.bodyLimit).toBe('4mb');
    });

    it('accepts a numeric byte count', () => {
      const parsed = httpOptionsSchema.parse({ bodyLimit: 2_097_152 });
      expect(parsed.bodyLimit).toBe(2_097_152);
    });

    it('accepts a body-parser style string', () => {
      const parsed = httpOptionsSchema.parse({ bodyLimit: '10mb' });
      expect(parsed.bodyLimit).toBe('10mb');
    });
  });

  describe('urlencodedLimit (issue #410)', () => {
    it('is undefined when omitted (adapter falls back to bodyLimit)', () => {
      const parsed = httpOptionsSchema.parse({});
      expect(parsed.urlencodedLimit).toBeUndefined();
    });

    it('passes through when explicitly set', () => {
      const parsed = httpOptionsSchema.parse({ urlencodedLimit: '256kb' });
      expect(parsed.urlencodedLimit).toBe('256kb');
    });
  });
});
