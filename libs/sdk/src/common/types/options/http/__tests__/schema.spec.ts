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

  describe('entryPath (issue #446 — frontmcp dev honors transport.http.path)', () => {
    const ENV = 'FRONTMCP_HTTP_ENTRY_PATH';
    const saved = process.env[ENV];

    afterEach(() => {
      if (saved === undefined) delete process.env[ENV];
      else process.env[ENV] = saved;
    });

    it('defaults to "" when omitted and the env is unset', () => {
      delete process.env[ENV];
      expect(httpOptionsSchema.parse({}).entryPath).toBe('');
    });

    it('reads FRONTMCP_HTTP_ENTRY_PATH when entryPath is omitted (dev propagates it)', () => {
      process.env[ENV] = '/mcp';
      expect(httpOptionsSchema.parse({}).entryPath).toBe('/mcp');
    });

    it('lets an explicit entryPath win over the env (default only applies when omitted)', () => {
      process.env[ENV] = '/from-env';
      expect(httpOptionsSchema.parse({ entryPath: '/explicit' }).entryPath).toBe('/explicit');
    });

    it('reads the env at parse time (function default), not module-load time', () => {
      delete process.env[ENV];
      expect(httpOptionsSchema.parse({}).entryPath).toBe('');
      process.env[ENV] = '/late';
      expect(httpOptionsSchema.parse({}).entryPath).toBe('/late');
    });
  });

  describe('bodyLimit format validation (CodeRabbit PR #422)', () => {
    it.each([
      ['1024', 1024],
      ['large bytes', 1_048_576],
      ['kb', '500kb'],
      ['mb (no decimal)', '4mb'],
      ['mb (with decimal)', '1.5mb'],
      ['gb', '2gb'],
      ['tb', '1tb'],
      ['pb (bytes library supports this)', '1pb'],
      ['uppercase unit', '4MB'],
      ['mixed case unit', '10Mb'],
      ['internal whitespace', '8 mb'],
      ['plain b unit', '512b'],
    ])('accepts valid limit: %s', (_label, value) => {
      const parsed = httpOptionsSchema.parse({ bodyLimit: value });
      expect(parsed.bodyLimit).toBe(value);
    });

    it.each([
      ['typo with extra letter', '4mbb'],
      ['unknown unit', '10xyz'],
      ['leading garbage', 'abc4mb'],
      ['bare decimal string without unit', '1.5'],
      ['negative integer', -1],
      ['non-integer number', 1.5],
      ['empty string', ''],
      ['only unit', 'mb'],
    ])('rejects invalid limit: %s', (_label, value) => {
      expect(() => httpOptionsSchema.parse({ bodyLimit: value })).toThrow();
    });
  });
});
