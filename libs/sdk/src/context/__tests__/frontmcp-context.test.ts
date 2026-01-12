/**
 * Unit tests for FrontMcpContext and validateSessionId
 */

import {
  FrontMcpContext,
  validateSessionId,
  SESSION_ID_MAX_LENGTH,
  SESSION_ID_VALID_PATTERN,
} from '../frontmcp-context';
import { generateTraceContext } from '../trace-context';
import { InvalidInputError } from '../../errors/mcp.error';

describe('validateSessionId', () => {
  describe('valid session IDs', () => {
    it('should accept alphanumeric session ID', () => {
      expect(() => validateSessionId('abc123')).not.toThrow();
    });

    it('should accept session ID with hyphens', () => {
      expect(() => validateSessionId('user-session-123')).not.toThrow();
    });

    it('should accept session ID with underscores', () => {
      expect(() => validateSessionId('user_session_123')).not.toThrow();
    });

    it('should accept session ID with periods', () => {
      expect(() => validateSessionId('user.session.123')).not.toThrow();
    });

    it('should accept session ID with colons (namespaced)', () => {
      expect(() => validateSessionId('anon:uuid-1234')).not.toThrow();
    });

    it('should accept session ID at max length', () => {
      const maxLengthId = 'a'.repeat(SESSION_ID_MAX_LENGTH);
      expect(() => validateSessionId(maxLengthId)).not.toThrow();
    });

    it('should accept UUID format', () => {
      expect(() => validateSessionId('550e8400-e29b-41d4-a716-446655440000')).not.toThrow();
    });
  });

  describe('invalid session IDs', () => {
    it('should reject empty string', () => {
      expect(() => validateSessionId('')).toThrow(InvalidInputError);
      expect(() => validateSessionId('')).toThrow('Session ID cannot be empty');
    });

    it('should reject session ID exceeding max length', () => {
      const tooLongId = 'a'.repeat(SESSION_ID_MAX_LENGTH + 1);
      expect(() => validateSessionId(tooLongId)).toThrow(InvalidInputError);
      expect(() => validateSessionId(tooLongId)).toThrow(
        `Session ID exceeds maximum length of ${SESSION_ID_MAX_LENGTH} characters`,
      );
    });

    it('should reject session ID with @ symbol', () => {
      expect(() => validateSessionId('user@domain')).toThrow(InvalidInputError);
      expect(() => validateSessionId('user@domain')).toThrow('invalid characters');
    });

    it('should reject session ID with spaces', () => {
      expect(() => validateSessionId('user session')).toThrow(InvalidInputError);
    });

    it('should reject session ID with special characters', () => {
      const invalidChars = [
        '!',
        '#',
        '$',
        '%',
        '^',
        '&',
        '*',
        '(',
        ')',
        '+',
        '=',
        '[',
        ']',
        '{',
        '}',
        '|',
        '\\',
        '/',
        '?',
        '<',
        '>',
        ',',
        ';',
        "'",
        '"',
        '`',
        '~',
      ];
      for (const char of invalidChars) {
        expect(() => validateSessionId(`session${char}id`)).toThrow(InvalidInputError);
      }
    });

    it('should reject session ID with newlines', () => {
      expect(() => validateSessionId('session\nid')).toThrow(InvalidInputError);
    });

    it('should reject session ID with tabs', () => {
      expect(() => validateSessionId('session\tid')).toThrow(InvalidInputError);
    });
  });

  describe('constants', () => {
    it('should export SESSION_ID_MAX_LENGTH as 2048', () => {
      expect(SESSION_ID_MAX_LENGTH).toBe(2048);
    });

    it('should export valid pattern regex', () => {
      expect(SESSION_ID_VALID_PATTERN).toBeInstanceOf(RegExp);
      expect(SESSION_ID_VALID_PATTERN.test('valid-session_123')).toBe(true);
      expect(SESSION_ID_VALID_PATTERN.test('invalid@session')).toBe(false);
    });
  });
});

describe('FrontMcpContext', () => {
  const validArgs = {
    sessionId: 'test-session-123',
    scopeId: 'test-scope',
  };

  describe('constructor', () => {
    it('should create context with minimal required args', () => {
      const ctx = new FrontMcpContext(validArgs);

      expect(ctx.sessionId).toBe('test-session-123');
      expect(ctx.scopeId).toBe('test-scope');
      expect(ctx.requestId).toBeDefined();
      expect(ctx.traceContext).toBeDefined();
      expect(ctx.timestamp).toBeDefined();
    });

    it('should use provided requestId', () => {
      const ctx = new FrontMcpContext({
        ...validArgs,
        requestId: 'custom-request-id',
      });

      expect(ctx.requestId).toBe('custom-request-id');
    });

    it('should use provided traceContext', () => {
      const traceContext = generateTraceContext();
      const ctx = new FrontMcpContext({
        ...validArgs,
        traceContext,
      });

      expect(ctx.traceContext).toBe(traceContext);
    });

    it('should use provided timestamp', () => {
      const timestamp = 1234567890;
      const ctx = new FrontMcpContext({
        ...validArgs,
        timestamp,
      });

      expect(ctx.timestamp).toBe(timestamp);
    });

    it('should validate session ID on construction', () => {
      expect(() => new FrontMcpContext({ ...validArgs, sessionId: '' })).toThrow(InvalidInputError);
      expect(() => new FrontMcpContext({ ...validArgs, sessionId: 'invalid@session' })).toThrow(InvalidInputError);
    });

    it('should set default config values', () => {
      const ctx = new FrontMcpContext(validArgs);

      expect(ctx.config.autoInjectAuthHeaders).toBe(true);
      expect(ctx.config.autoInjectTracingHeaders).toBe(true);
      expect(ctx.config.requestTimeout).toBe(30000);
    });

    it('should override config values when provided', () => {
      const ctx = new FrontMcpContext({
        ...validArgs,
        config: {
          autoInjectAuthHeaders: false,
          autoInjectTracingHeaders: false,
          requestTimeout: 60000,
        },
      });

      expect(ctx.config.autoInjectAuthHeaders).toBe(false);
      expect(ctx.config.autoInjectTracingHeaders).toBe(false);
      expect(ctx.config.requestTimeout).toBe(60000);
    });

    it('should initialize metadata with empty customHeaders if not provided', () => {
      const ctx = new FrontMcpContext(validArgs);

      expect(ctx.metadata.customHeaders).toEqual({});
    });

    it('should use provided metadata', () => {
      const ctx = new FrontMcpContext({
        ...validArgs,
        metadata: {
          userAgent: 'Test/1.0',
          clientIp: '192.168.1.1',
          customHeaders: { 'x-frontmcp-test': 'value' },
        },
      });

      expect(ctx.metadata.userAgent).toBe('Test/1.0');
      expect(ctx.metadata.clientIp).toBe('192.168.1.1');
      expect(ctx.metadata.customHeaders).toEqual({ 'x-frontmcp-test': 'value' });
    });
  });

  describe('authInfo', () => {
    it('should return empty authInfo by default', () => {
      const ctx = new FrontMcpContext(validArgs);

      expect(ctx.authInfo).toEqual({});
    });

    it('should use provided authInfo', () => {
      const ctx = new FrontMcpContext({
        ...validArgs,
        authInfo: { token: 'test-token', clientId: 'test-client' },
      });

      expect(ctx.authInfo.token).toBe('test-token');
      expect(ctx.authInfo.clientId).toBe('test-client');
    });

    it('should update authInfo via updateAuthInfo', () => {
      const ctx = new FrontMcpContext(validArgs);

      ctx.updateAuthInfo({ token: 'new-token' });
      expect(ctx.authInfo.token).toBe('new-token');

      ctx.updateAuthInfo({ clientId: 'new-client' });
      expect(ctx.authInfo.token).toBe('new-token');
      expect(ctx.authInfo.clientId).toBe('new-client');
    });
  });

  describe('sessionMetadata', () => {
    it('should return undefined by default', () => {
      const ctx = new FrontMcpContext(validArgs);

      expect(ctx.sessionMetadata).toBeUndefined();
    });

    it('should update via updateSessionMetadata', () => {
      const ctx = new FrontMcpContext(validArgs);
      const metadata = { protocol: 'mcp', platformType: 'web' } as any;

      ctx.updateSessionMetadata(metadata);

      expect(ctx.sessionMetadata).toBe(metadata);
    });
  });

  describe('references (transport, flow, scope)', () => {
    it('should return undefined transport by default', () => {
      const ctx = new FrontMcpContext(validArgs);

      expect(ctx.transport).toBeUndefined();
    });

    it('should set and expose transport accessor', () => {
      const ctx = new FrontMcpContext(validArgs);
      const mockTransport = {
        sendElicitRequest: jest.fn().mockResolvedValue({ action: 'submit', content: {} }),
        type: 'sse',
      };

      ctx.setTransport(mockTransport);

      expect(ctx.transport).toBeDefined();
      expect(ctx.transport!.supportsElicit).toBe(true);
    });

    it('should return undefined flow by default', () => {
      const ctx = new FrontMcpContext(validArgs);

      expect(ctx.flow).toBeUndefined();
    });

    it('should set flow reference', () => {
      const ctx = new FrontMcpContext(validArgs);
      const mockFlow = { name: 'test-flow' };

      ctx.setFlow(mockFlow);

      expect(ctx.flow).toBe(mockFlow);
    });

    it('should return undefined scope by default', () => {
      const ctx = new FrontMcpContext(validArgs);

      expect(ctx.scope).toBeUndefined();
    });

    it('should set scope reference', () => {
      const ctx = new FrontMcpContext(validArgs);
      const mockScope = { id: 'scope-1', logger: { child: jest.fn() } as any };

      ctx.setScope(mockScope);

      expect(ctx.scope).toBe(mockScope);
    });
  });

  describe('store operations', () => {
    it('should store and retrieve values', () => {
      const ctx = new FrontMcpContext(validArgs);

      ctx.set('key1', 'value1');
      ctx.set('key2', { nested: 'object' });

      expect(ctx.get('key1')).toBe('value1');
      expect(ctx.get('key2')).toEqual({ nested: 'object' });
    });

    it('should return undefined for non-existent keys', () => {
      const ctx = new FrontMcpContext(validArgs);

      expect(ctx.get('nonexistent')).toBeUndefined();
    });

    it('should support symbol keys', () => {
      const ctx = new FrontMcpContext(validArgs);
      const key = Symbol('test-key');

      ctx.set(key, 'symbol-value');

      expect(ctx.get(key)).toBe('symbol-value');
    });

    it('should check if key exists with has()', () => {
      const ctx = new FrontMcpContext(validArgs);

      ctx.set('exists', 'value');

      expect(ctx.has('exists')).toBe(true);
      expect(ctx.has('not-exists')).toBe(false);
    });

    it('should delete keys', () => {
      const ctx = new FrontMcpContext(validArgs);

      ctx.set('key', 'value');
      expect(ctx.has('key')).toBe(true);

      const deleted = ctx.delete('key');

      expect(deleted).toBe(true);
      expect(ctx.has('key')).toBe(false);
    });

    it('should return false when deleting non-existent key', () => {
      const ctx = new FrontMcpContext(validArgs);

      const deleted = ctx.delete('nonexistent');

      expect(deleted).toBe(false);
    });
  });

  describe('timing marks', () => {
    it('should have init mark set on construction', () => {
      const ctx = new FrontMcpContext(validArgs);

      const marks = ctx.getMarks();

      expect(marks.has('init')).toBe(true);
    });

    it('should add timing marks', () => {
      const ctx = new FrontMcpContext(validArgs);

      ctx.mark('start');
      ctx.mark('middle');
      ctx.mark('end');

      const marks = ctx.getMarks();

      expect(marks.has('start')).toBe(true);
      expect(marks.has('middle')).toBe(true);
      expect(marks.has('end')).toBe(true);
    });

    it('should calculate elapsed time from init by default', () => {
      const ctx = new FrontMcpContext({
        ...validArgs,
        timestamp: Date.now() - 1000,
      });

      const elapsed = ctx.elapsed();

      expect(elapsed).toBeGreaterThanOrEqual(1000);
      expect(elapsed).toBeLessThan(2000);
    });

    it('should calculate elapsed time between marks', () => {
      const ctx = new FrontMcpContext(validArgs);

      ctx.mark('start');
      // Simulate some time passing
      const marks = ctx.getMarks() as Map<string, number>;
      marks.set('end', marks.get('start')! + 500);

      const elapsed = ctx.elapsed('start', 'end');

      expect(elapsed).toBe(500);
    });
  });

  describe('logging', () => {
    it('should create child logger with prefix', () => {
      const ctx = new FrontMcpContext(validArgs);
      const mockChild = jest.fn().mockReturnValue({ info: jest.fn() });
      const mockLogger = { child: mockChild } as any;

      const childLogger = ctx.getLogger(mockLogger);

      expect(mockChild).toHaveBeenCalled();
      const prefix = mockChild.mock.calls[0][0];
      expect(prefix).toMatch(/^\[.+:.+\]$/); // [requestId:traceId]
    });

    it('should generate log context with hashed sessionId', () => {
      const ctx = new FrontMcpContext(validArgs);
      ctx.setFlow({ name: 'test-flow' });

      const logContext = ctx.toLogContext();

      expect(logContext.requestId).toBe(ctx.requestId);
      expect(logContext.traceId).toBe(ctx.traceContext.traceId);
      expect(logContext.sessionIdHash).toBeDefined();
      expect(logContext.sessionIdHash).not.toBe(ctx.sessionId); // Should be hashed
      expect(typeof logContext.sessionIdHash).toBe('string');
      expect(logContext.sessionIdHash.length).toBe(12); // First 12 chars of hash
      expect(logContext.scopeId).toBe('test-scope');
      expect(logContext.flowName).toBe('test-flow');
      expect(typeof logContext.elapsed).toBe('number');
    });
  });

  describe('fetch', () => {
    const originalFetch = global.fetch;

    beforeEach(() => {
      global.fetch = jest.fn().mockResolvedValue(new Response('OK'));
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it('should call fetch with provided URL', async () => {
      const ctx = new FrontMcpContext(validArgs);

      await ctx.fetch('https://api.example.com/data');

      expect(global.fetch).toHaveBeenCalledWith('https://api.example.com/data', expect.any(Object));
    });

    it('should inject traceparent header when autoInjectTracingHeaders is true', async () => {
      const ctx = new FrontMcpContext(validArgs);

      await ctx.fetch('https://api.example.com/data');

      const [, options] = (global.fetch as jest.Mock).mock.calls[0];
      const headers = options.headers as Headers;

      expect(headers.get('traceparent')).toBe(ctx.traceContext.raw);
      expect(headers.get('x-request-id')).toBe(ctx.requestId);
    });

    it('should inject Authorization header when token is available', async () => {
      const ctx = new FrontMcpContext(validArgs);
      ctx.updateAuthInfo({ token: 'test-bearer-token' });

      await ctx.fetch('https://api.example.com/data');

      const [, options] = (global.fetch as jest.Mock).mock.calls[0];
      const headers = options.headers as Headers;

      expect(headers.get('Authorization')).toBe('Bearer test-bearer-token');
    });

    it('should not inject Authorization when already present', async () => {
      const ctx = new FrontMcpContext(validArgs);
      ctx.updateAuthInfo({ token: 'test-token' });

      await ctx.fetch('https://api.example.com/data', {
        headers: { Authorization: 'Bearer existing-token' },
      });

      const [, options] = (global.fetch as jest.Mock).mock.calls[0];
      const headers = options.headers as Headers;

      expect(headers.get('Authorization')).toBe('Bearer existing-token');
    });

    it('should not inject headers when disabled in config', async () => {
      const ctx = new FrontMcpContext({
        ...validArgs,
        config: {
          autoInjectAuthHeaders: false,
          autoInjectTracingHeaders: false,
        },
      });
      ctx.updateAuthInfo({ token: 'test-token' });

      await ctx.fetch('https://api.example.com/data');

      const [, options] = (global.fetch as jest.Mock).mock.calls[0];
      const headers = options.headers as Headers;

      expect(headers.get('Authorization')).toBeNull();
      expect(headers.get('traceparent')).toBeNull();
    });

    it('should inject custom headers from metadata', async () => {
      const ctx = new FrontMcpContext({
        ...validArgs,
        metadata: {
          customHeaders: {
            'x-frontmcp-tenant': 'tenant-123',
            'x-frontmcp-org': 'org-456',
          },
        },
      });

      await ctx.fetch('https://api.example.com/data');

      const [, options] = (global.fetch as jest.Mock).mock.calls[0];
      const headers = options.headers as Headers;

      expect(headers.get('x-frontmcp-tenant')).toBe('tenant-123');
      expect(headers.get('x-frontmcp-org')).toBe('org-456');
    });

    it('should use timeout from config', async () => {
      const ctx = new FrontMcpContext({
        ...validArgs,
        config: { requestTimeout: 5000 },
      });

      await ctx.fetch('https://api.example.com/data');

      const [, options] = (global.fetch as jest.Mock).mock.calls[0];

      expect(options.signal).toBeDefined();
    });
  });

  describe('Context alias', () => {
    it('should export Context as alias for FrontMcpContext', async () => {
      const { Context } = await import('../frontmcp-context');

      expect(Context).toBe(FrontMcpContext);
    });
  });
});
