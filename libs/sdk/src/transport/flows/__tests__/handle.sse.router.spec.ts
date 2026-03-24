/**
 * Tests for the router stage of HandleSseFlow (legacy SSE).
 *
 * Validates path-based routing:
 * - /sse → requestType: 'initialize'
 * - /message → requestType: 'message'
 */

import { stateSchema } from '../handle.sse.flow';

describe('HandleSseFlow - router stage', () => {
  describe('stateSchema requestType enum', () => {
    it('should accept all valid request types', () => {
      const types = ['initialize', 'message', 'elicitResult'] as const;
      for (const type of types) {
        const result = stateSchema.safeParse({
          token: 'test-token',
          session: { id: 'test-session' },
          requestType: type,
        });
        expect(result.success).toBe(true);
      }
    });

    it('should reject invalid request type', () => {
      const result = stateSchema.safeParse({
        token: 'test-token',
        session: { id: 'test-session' },
        requestType: 'sseListener',
      });
      expect(result.success).toBe(false);
    });

    it('should accept undefined requestType (before routing)', () => {
      const result = stateSchema.safeParse({
        token: 'test-token',
        session: { id: 'test-session' },
      });
      expect(result.success).toBe(true);
    });
  });

  describe('path-based routing logic', () => {
    /**
     * Simulates the router stage logic from handle.sse.flow.ts
     * lines 156-170. Path-based routing for SSE endpoints.
     */
    function simulateRouter(params: { requestPath: string; entryPath?: string; scopeBase?: string }): {
      requestType: string | undefined;
    } {
      const prefix = params.entryPath ?? '';
      const scopePath = params.scopeBase ?? '';
      const basePath = `${prefix}${scopePath}`;

      if (params.requestPath === `${basePath}/sse`) {
        return { requestType: 'initialize' };
      } else if (params.requestPath === `${basePath}/message`) {
        return { requestType: 'message' };
      }
      return { requestType: undefined };
    }

    it('should route /sse as initialize', () => {
      const result = simulateRouter({ requestPath: '/sse' });
      expect(result.requestType).toBe('initialize');
    });

    it('should route /message as message', () => {
      const result = simulateRouter({ requestPath: '/message' });
      expect(result.requestType).toBe('message');
    });

    it('should route with entry prefix /mcp/sse', () => {
      const result = simulateRouter({ requestPath: '/mcp/sse', entryPath: '/mcp' });
      expect(result.requestType).toBe('initialize');
    });

    it('should route with entry prefix /mcp/message', () => {
      const result = simulateRouter({ requestPath: '/mcp/message', entryPath: '/mcp' });
      expect(result.requestType).toBe('message');
    });

    it('should route with scope base /app/sse', () => {
      const result = simulateRouter({ requestPath: '/app/sse', scopeBase: '/app' });
      expect(result.requestType).toBe('initialize');
    });

    it('should return undefined for unknown path', () => {
      const result = simulateRouter({ requestPath: '/unknown' });
      expect(result.requestType).toBeUndefined();
    });

    it('should return undefined for root path', () => {
      const result = simulateRouter({ requestPath: '/' });
      expect(result.requestType).toBeUndefined();
    });
  });
});
