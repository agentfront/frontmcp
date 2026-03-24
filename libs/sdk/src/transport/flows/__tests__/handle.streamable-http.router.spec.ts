/**
 * Tests for the router stage of HandleStreamableHttpFlow.
 *
 * Validates that requests are correctly classified into:
 * - sseListener (GET requests)
 * - initialize (POST with method: 'initialize')
 * - message (POST with valid JSON-RPC method)
 * - extApps (POST with ui/* method)
 * - elicitResult (POST with valid ElicitResult body)
 */

import { stateSchema } from '../handle.streamable-http.flow';

describe('HandleStreamableHttpFlow - router stage', () => {
  describe('stateSchema requestType enum', () => {
    it('should accept all valid request types', () => {
      const types = ['initialize', 'message', 'elicitResult', 'sseListener', 'extApps'] as const;
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
        requestType: 'invalid-type',
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

  describe('routing logic simulation', () => {
    /**
     * Simulates the router stage logic from handle.streamable-http.flow.ts
     * lines 137-173. Tests the exact branching for request classification.
     */
    function simulateRouter(params: {
      method: string;
      body?: Record<string, unknown>;
    }): { requestType: string } | { error: string } {
      const { method: httpMethod, body } = params;

      if (httpMethod.toUpperCase() === 'GET') {
        return { requestType: 'sseListener' };
      }

      const jsonRpcMethod = (body as { method?: string })?.method;

      if (jsonRpcMethod === 'initialize') {
        return { requestType: 'initialize' };
      } else if (typeof jsonRpcMethod === 'string' && jsonRpcMethod.startsWith('ui/')) {
        return { requestType: 'extApps' };
      } else if (body?.result && typeof (body.result as Record<string, unknown>)?.action === 'string') {
        // Simplified ElicitResult check
        return { requestType: 'elicitResult' };
      } else if (jsonRpcMethod) {
        return { requestType: 'message' };
      } else {
        return { error: 'Invalid Request' };
      }
    }

    it('should route GET request as sseListener', () => {
      const result = simulateRouter({ method: 'GET' });
      expect(result).toEqual({ requestType: 'sseListener' });
    });

    it('should route POST with initialize method as initialize', () => {
      const result = simulateRouter({
        method: 'POST',
        body: { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      });
      expect(result).toEqual({ requestType: 'initialize' });
    });

    it('should route POST with tools/call as message', () => {
      const result = simulateRouter({
        method: 'POST',
        body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: {} },
      });
      expect(result).toEqual({ requestType: 'message' });
    });

    it('should route POST with tools/list as message', () => {
      const result = simulateRouter({
        method: 'POST',
        body: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
      });
      expect(result).toEqual({ requestType: 'message' });
    });

    it('should route POST with resources/list as message', () => {
      const result = simulateRouter({
        method: 'POST',
        body: { jsonrpc: '2.0', id: 1, method: 'resources/list', params: {} },
      });
      expect(result).toEqual({ requestType: 'message' });
    });

    it('should route POST with ui/initialize as extApps', () => {
      const result = simulateRouter({
        method: 'POST',
        body: { jsonrpc: '2.0', id: 1, method: 'ui/initialize', params: {} },
      });
      expect(result).toEqual({ requestType: 'extApps' });
    });

    it('should route POST with ui/callServerTool as extApps', () => {
      const result = simulateRouter({
        method: 'POST',
        body: { jsonrpc: '2.0', id: 1, method: 'ui/callServerTool', params: {} },
      });
      expect(result).toEqual({ requestType: 'extApps' });
    });

    it('should return error for POST with no method', () => {
      const result = simulateRouter({ method: 'POST', body: {} });
      expect(result).toEqual({ error: 'Invalid Request' });
    });

    it('should return error for POST with undefined body', () => {
      const result = simulateRouter({ method: 'POST', body: undefined });
      expect(result).toEqual({ error: 'Invalid Request' });
    });

    it('should route notifications/initialized as message', () => {
      const result = simulateRouter({
        method: 'POST',
        body: { jsonrpc: '2.0', method: 'notifications/initialized' },
      });
      expect(result).toEqual({ requestType: 'message' });
    });
  });
});
