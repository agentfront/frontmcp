// common/types/options/__tests__/http.options.test.ts

import { httpOptionsSchema } from '../http';

describe('httpOptionsSchema', () => {
  describe('default values', () => {
    it('should apply default port of 3001', () => {
      const result = httpOptionsSchema.parse({});
      expect(result.port).toBe(3001);
    });

    it('should apply default entryPath of empty string', () => {
      const result = httpOptionsSchema.parse({});
      expect(result.entryPath).toBe('');
    });

    it('should leave cors as undefined by default', () => {
      const result = httpOptionsSchema.parse({});
      expect(result.cors).toBeUndefined();
    });
  });

  describe('cors option', () => {
    it('should accept cors: false to disable CORS', () => {
      const result = httpOptionsSchema.parse({ cors: false });
      expect(result.cors).toBe(false);
    });

    it('should accept cors with origin: true and credentials: true', () => {
      const result = httpOptionsSchema.parse({
        cors: { origin: true, credentials: true },
      });
      expect(result.cors).toEqual({ origin: true, credentials: true });
    });

    it('should accept cors with a specific origin string', () => {
      const result = httpOptionsSchema.parse({
        cors: { origin: 'https://example.com', maxAge: 600 },
      });
      expect(result.cors).toEqual({ origin: 'https://example.com', maxAge: 600 });
    });

    it('should accept cors with an array of origins', () => {
      const result = httpOptionsSchema.parse({
        cors: { origin: ['https://a.com', 'https://b.com'] },
      });
      expect(result.cors).toEqual({ origin: ['https://a.com', 'https://b.com'] });
    });

    it('should accept cors with origin function', () => {
      const originFn = (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => {
        cb(null, true);
      };
      const result = httpOptionsSchema.parse({ cors: { origin: originFn } });
      expect(typeof (result.cors as Record<string, unknown>).origin).toBe('function');
    });

    it('should accept cors with all fields', () => {
      const result = httpOptionsSchema.parse({
        cors: { origin: true, credentials: true, maxAge: 3600 },
      });
      expect(result.cors).toEqual({ origin: true, credentials: true, maxAge: 3600 });
    });

    it('should accept empty cors object', () => {
      const result = httpOptionsSchema.parse({ cors: {} });
      expect(result.cors).toEqual({});
    });
  });

  describe('cors negative validation', () => {
    it('should reject cors: true (only false is valid as a literal)', () => {
      expect(() => httpOptionsSchema.parse({ cors: true })).toThrow();
    });

    it('should reject cors as a string', () => {
      expect(() => httpOptionsSchema.parse({ cors: 'invalid' })).toThrow();
    });

    it('should reject cors with non-boolean credentials', () => {
      expect(() => httpOptionsSchema.parse({ cors: { credentials: 'yes' } })).toThrow();
    });

    it('should reject cors with non-number maxAge', () => {
      expect(() => httpOptionsSchema.parse({ cors: { maxAge: 'not-a-number' } })).toThrow();
    });
  });

  describe('full config', () => {
    it('should parse complete HTTP config with cors', () => {
      const result = httpOptionsSchema.parse({
        port: 8080,
        entryPath: '/mcp',
        socketPath: '/tmp/mcp.sock',
        cors: { origin: 'https://inspector.example.com', credentials: true, maxAge: 300 },
      });

      expect(result.port).toBe(8080);
      expect(result.entryPath).toBe('/mcp');
      expect(result.socketPath).toBe('/tmp/mcp.sock');
      expect(result.cors).toEqual({
        origin: 'https://inspector.example.com',
        credentials: true,
        maxAge: 300,
      });
    });

    it('should parse config with cors disabled', () => {
      const result = httpOptionsSchema.parse({
        port: 3001,
        cors: false,
      });

      expect(result.port).toBe(3001);
      expect(result.cors).toBe(false);
    });
  });
});
