/**
 * Unit tests for FrontMcpContextStorage
 */

import 'reflect-metadata';
import { FrontMcpContextStorage } from '../frontmcp-context-storage';
import { FrontMcpContext } from '../frontmcp-context';
import { RequestContextNotAvailableError } from '../../errors/mcp.error';

describe('FrontMcpContextStorage', () => {
  let storage: FrontMcpContextStorage;

  beforeEach(() => {
    storage = new FrontMcpContextStorage();
  });

  describe('run', () => {
    it('should run callback with context available', () => {
      const result = storage.run({ sessionId: 'test-session', scopeId: 'test-scope' }, () => {
        const ctx = storage.getStore();
        expect(ctx).toBeDefined();
        expect(ctx?.sessionId).toBe('test-session');
        return 'success';
      });

      expect(result).toBe('success');
    });

    it('should support async callbacks', async () => {
      const result = await storage.run({ sessionId: 'test-session', scopeId: 'test-scope' }, async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        const ctx = storage.getStore();
        return ctx?.sessionId;
      });

      expect(result).toBe('test-session');
    });

    it('should pass all args to FrontMcpContext constructor', () => {
      storage.run(
        {
          sessionId: 'my-session',
          scopeId: 'my-scope',
          requestId: 'custom-request-id',
          timestamp: 1234567890,
          authInfo: { token: 'test-token' },
          config: { requestTimeout: 5000 },
        },
        () => {
          const ctx = storage.getStore()!;

          expect(ctx.sessionId).toBe('my-session');
          expect(ctx.scopeId).toBe('my-scope');
          expect(ctx.requestId).toBe('custom-request-id');
          expect(ctx.timestamp).toBe(1234567890);
          expect(ctx.authInfo.token).toBe('test-token');
          expect(ctx.config.requestTimeout).toBe(5000);
        },
      );
    });

    it('should isolate context between parallel runs', async () => {
      const results = await Promise.all([
        storage.run({ sessionId: 'session-1', scopeId: 'scope' }, async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return storage.getStore()?.sessionId;
        }),
        storage.run({ sessionId: 'session-2', scopeId: 'scope' }, async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          return storage.getStore()?.sessionId;
        }),
      ]);

      expect(results).toEqual(['session-1', 'session-2']);
    });

    it('should support nested runs', () => {
      storage.run({ sessionId: 'outer', scopeId: 'scope' }, () => {
        expect(storage.getStore()?.sessionId).toBe('outer');

        storage.run({ sessionId: 'inner', scopeId: 'scope' }, () => {
          expect(storage.getStore()?.sessionId).toBe('inner');
        });

        // After inner run completes, outer context is restored
        expect(storage.getStore()?.sessionId).toBe('outer');
      });
    });
  });

  describe('runFromHeaders', () => {
    it('should extract trace context from traceparent header', () => {
      const headers = {
        traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
      };

      storage.runFromHeaders(headers, { sessionId: 'test-session', scopeId: 'test-scope' }, () => {
        const ctx = storage.getStore()!;

        expect(ctx.traceContext.traceId).toBe('0af7651916cd43dd8448eb211c80319c');
        expect(ctx.traceContext.parentId).toBe('b7ad6b7169203331');
        expect(ctx.traceContext.traceFlags).toBe(1);
      });
    });

    it('should extract metadata from headers', () => {
      const headers = {
        'user-agent': 'TestClient/1.0',
        'content-type': 'application/json',
        accept: 'application/json',
        'x-forwarded-for': '192.168.1.100, 10.0.0.1',
        'x-frontmcp-tenant': 'tenant-123',
        'x-frontmcp-org': 'org-456',
      };

      storage.runFromHeaders(headers, { sessionId: 'test-session', scopeId: 'test-scope' }, () => {
        const ctx = storage.getStore()!;

        expect(ctx.metadata.userAgent).toBe('TestClient/1.0');
        expect(ctx.metadata.contentType).toBe('application/json');
        expect(ctx.metadata.accept).toBe('application/json');
        expect(ctx.metadata.clientIp).toBe('192.168.1.100');
        expect(ctx.metadata.customHeaders['x-frontmcp-tenant']).toBe('tenant-123');
        expect(ctx.metadata.customHeaders['x-frontmcp-org']).toBe('org-456');
      });
    });

    it('should generate trace context if not provided', () => {
      storage.runFromHeaders({}, { sessionId: 'test-session', scopeId: 'test-scope' }, () => {
        const ctx = storage.getStore()!;

        expect(ctx.traceContext).toBeDefined();
        expect(ctx.traceContext.traceId).toHaveLength(32);
        expect(ctx.traceContext.parentId).toHaveLength(16);
      });
    });

    it('should support x-frontmcp-trace-id fallback', () => {
      const headers = {
        'x-frontmcp-trace-id': 'abcd1234abcd1234abcd1234abcd1234',
      };

      storage.runFromHeaders(headers, { sessionId: 'test-session', scopeId: 'test-scope' }, () => {
        const ctx = storage.getStore()!;

        expect(ctx.traceContext.traceId).toBe('abcd1234abcd1234abcd1234abcd1234');
      });
    });
  });

  describe('runWithContext', () => {
    it('should run with an existing context', () => {
      const existingContext = new FrontMcpContext({
        sessionId: 'existing-session',
        scopeId: 'existing-scope',
        requestId: 'existing-request',
      });

      storage.runWithContext(existingContext, () => {
        const ctx = storage.getStore();

        expect(ctx).toBe(existingContext);
        expect(ctx?.sessionId).toBe('existing-session');
        expect(ctx?.requestId).toBe('existing-request');
      });
    });

    it('should preserve context state', () => {
      const existingContext = new FrontMcpContext({
        sessionId: 'existing-session',
        scopeId: 'existing-scope',
      });

      // Modify context before running
      existingContext.set('key', 'value');
      existingContext.updateAuthInfo({ token: 'preserved-token' });
      existingContext.mark('custom-mark');

      storage.runWithContext(existingContext, () => {
        const ctx = storage.getStore()!;

        expect(ctx.get('key')).toBe('value');
        expect(ctx.authInfo.token).toBe('preserved-token');
        expect(ctx.getMarks().has('custom-mark')).toBe(true);
      });
    });
  });

  describe('getStore', () => {
    it('should return undefined when not in context', () => {
      const ctx = storage.getStore();

      expect(ctx).toBeUndefined();
    });

    it('should return context when in context scope', () => {
      storage.run({ sessionId: 'test', scopeId: 'scope' }, () => {
        const ctx = storage.getStore();

        expect(ctx).toBeDefined();
        expect(ctx).toBeInstanceOf(FrontMcpContext);
      });
    });
  });

  describe('getStoreOrThrow', () => {
    it('should throw RequestContextNotAvailableError when not in context', () => {
      expect(() => storage.getStoreOrThrow()).toThrow(RequestContextNotAvailableError);
      expect(() => storage.getStoreOrThrow()).toThrow('FrontMcpContext not available');
    });

    it('should return context when in context scope', () => {
      storage.run({ sessionId: 'test', scopeId: 'scope' }, () => {
        const ctx = storage.getStoreOrThrow();

        expect(ctx).toBeDefined();
        expect(ctx).toBeInstanceOf(FrontMcpContext);
        expect(ctx.sessionId).toBe('test');
      });
    });
  });

  describe('hasContext', () => {
    it('should return false when not in context', () => {
      expect(storage.hasContext()).toBe(false);
    });

    it('should return true when in context scope', () => {
      storage.run({ sessionId: 'test', scopeId: 'scope' }, () => {
        expect(storage.hasContext()).toBe(true);
      });
    });
  });

  describe('updateAuthInfo', () => {
    it('should update authInfo on current context', () => {
      storage.run({ sessionId: 'test', scopeId: 'scope' }, () => {
        storage.updateAuthInfo({ token: 'new-token' }, () => {
          const ctx = storage.getStore()!;

          expect(ctx.authInfo.token).toBe('new-token');
        });
      });
    });

    it('should merge authInfo fields', () => {
      storage.run({ sessionId: 'test', scopeId: 'scope', authInfo: { clientId: 'initial-client' } }, () => {
        storage.updateAuthInfo({ token: 'new-token' }, () => {
          const ctx = storage.getStore()!;

          expect(ctx.authInfo.clientId).toBe('initial-client');
          expect(ctx.authInfo.token).toBe('new-token');
        });
      });
    });

    it('should throw when called outside context', () => {
      expect(() => storage.updateAuthInfo({ token: 'test' }, () => {})).toThrow(RequestContextNotAvailableError);
    });

    it('should return callback result', () => {
      const result = storage.run({ sessionId: 'test', scopeId: 'scope' }, () => {
        return storage.updateAuthInfo({ token: 'test' }, () => 'callback-result');
      });

      expect(result).toBe('callback-result');
    });

    it('should support async callbacks', async () => {
      const result = await storage.run({ sessionId: 'test', scopeId: 'scope' }, async () => {
        return storage.updateAuthInfo({ token: 'test' }, async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return 'async-result';
        });
      });

      expect(result).toBe('async-result');
    });
  });

  describe('ContextStorage alias', () => {
    it('should export ContextStorage as alias', async () => {
      const { ContextStorage } = await import('../frontmcp-context-storage');

      expect(ContextStorage).toBe(FrontMcpContextStorage);
    });
  });
});
