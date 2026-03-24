/**
 * Tests for the router-stage helpers of HandleStreamableHttpFlow.
 *
 * Validates request classification for:
 * - sseListener (GET)
 * - initialize (POST with initialize method)
 * - message (generic JSON-RPC methods)
 * - extApps (ui/* methods)
 * - elicitResult (POST with valid elicitation result body)
 */

import { classifyStreamableHttpRequest, stateSchema } from '../handle.streamable-http.flow';

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

  describe('routing logic', () => {
    it('should route GET request as sseListener', () => {
      const result = classifyStreamableHttpRequest({ method: 'GET', body: undefined });
      expect(result).toEqual({ requestType: 'sseListener' });
    });

    it('should route POST with initialize method as initialize', () => {
      const result = classifyStreamableHttpRequest({
        method: 'POST',
        body: { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      });
      expect(result).toEqual({ requestType: 'initialize' });
    });

    it('should route POST with tools/call as message', () => {
      const result = classifyStreamableHttpRequest({
        method: 'POST',
        body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: {} },
      });
      expect(result).toEqual({ requestType: 'message' });
    });

    it('should route POST with tools/list as message', () => {
      const result = classifyStreamableHttpRequest({
        method: 'POST',
        body: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
      });
      expect(result).toEqual({ requestType: 'message' });
    });

    it('should route POST with resources/list as message', () => {
      const result = classifyStreamableHttpRequest({
        method: 'POST',
        body: { jsonrpc: '2.0', id: 1, method: 'resources/list', params: {} },
      });
      expect(result).toEqual({ requestType: 'message' });
    });

    it('should route POST with ui/initialize as extApps', () => {
      const result = classifyStreamableHttpRequest({
        method: 'POST',
        body: { jsonrpc: '2.0', id: 1, method: 'ui/initialize', params: {} },
      });
      expect(result).toEqual({ requestType: 'extApps' });
    });

    it('should route POST with ui/callServerTool as extApps', () => {
      const result = classifyStreamableHttpRequest({
        method: 'POST',
        body: { jsonrpc: '2.0', id: 1, method: 'ui/callServerTool', params: {} },
      });
      expect(result).toEqual({ requestType: 'extApps' });
    });

    it('should route valid elicitation results as elicitResult', () => {
      const result = classifyStreamableHttpRequest({
        method: 'POST',
        body: { jsonrpc: '2.0', id: 1, result: { action: 'accept', content: {} } },
      });
      expect(result).toEqual({ requestType: 'elicitResult' });
    });

    it('should return error for POST with no method', () => {
      const result = classifyStreamableHttpRequest({ method: 'POST', body: {} });
      expect(result).toEqual({ error: 'Invalid Request' });
    });

    it('should return error for POST with undefined body', () => {
      const result = classifyStreamableHttpRequest({ method: 'POST', body: undefined });
      expect(result).toEqual({ error: 'Invalid Request' });
    });

    it('should route notifications/initialized as message', () => {
      const result = classifyStreamableHttpRequest({
        method: 'POST',
        body: { jsonrpc: '2.0', method: 'notifications/initialized' },
      });
      expect(result).toEqual({ requestType: 'message' });
    });
  });
});
