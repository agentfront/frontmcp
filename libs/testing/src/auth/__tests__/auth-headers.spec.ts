import { AuthHeaders } from '../auth-headers';

describe('AuthHeaders', () => {
  describe('bearer', () => {
    it('should return Authorization header with Bearer prefix', () => {
      const headers = AuthHeaders.bearer('my-token-123');
      expect(headers).toEqual({ Authorization: 'Bearer my-token-123' });
    });

    it('should handle empty string token', () => {
      const headers = AuthHeaders.bearer('');
      expect(headers).toEqual({ Authorization: 'Bearer ' });
    });
  });

  describe('noAuth', () => {
    it('should return an empty headers object', () => {
      const headers = AuthHeaders.noAuth();
      expect(headers).toEqual({});
    });
  });

  describe('mcpRequest', () => {
    it('should return Content-Type, Accept, and Authorization headers', () => {
      const headers = AuthHeaders.mcpRequest('tok-abc');
      expect(headers).toEqual({
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: 'Bearer tok-abc',
      });
    });

    it('should include mcp-session-id when sessionId is provided', () => {
      const headers = AuthHeaders.mcpRequest('tok-abc', 'session-42');
      expect(headers).toEqual({
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: 'Bearer tok-abc',
        'mcp-session-id': 'session-42',
      });
    });

    it('should omit mcp-session-id when sessionId is undefined', () => {
      const headers = AuthHeaders.mcpRequest('tok-abc', undefined);
      expect(headers).not.toHaveProperty('mcp-session-id');
    });

    it('should omit mcp-session-id when sessionId is empty string (falsy)', () => {
      const headers = AuthHeaders.mcpRequest('tok-abc', '');
      expect(headers).not.toHaveProperty('mcp-session-id');
    });
  });

  describe('publicMode', () => {
    it('should return Content-Type and Accept headers without Authorization', () => {
      const headers = AuthHeaders.publicMode();
      expect(headers).toEqual({
        'Content-Type': 'application/json',
        Accept: 'application/json',
      });
      expect(headers).not.toHaveProperty('Authorization');
    });

    it('should include mcp-session-id when sessionId is provided', () => {
      const headers = AuthHeaders.publicMode('sess-99');
      expect(headers).toEqual({
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'mcp-session-id': 'sess-99',
      });
    });

    it('should omit mcp-session-id when sessionId is undefined', () => {
      const headers = AuthHeaders.publicMode(undefined);
      expect(headers).not.toHaveProperty('mcp-session-id');
    });

    it('should omit mcp-session-id when sessionId is empty string (falsy)', () => {
      const headers = AuthHeaders.publicMode('');
      expect(headers).not.toHaveProperty('mcp-session-id');
    });
  });

  describe('custom', () => {
    it('should create a single-entry header object with the given name and value', () => {
      const headers = AuthHeaders.custom('X-Api-Key', 'key-123');
      expect(headers).toEqual({ 'X-Api-Key': 'key-123' });
    });

    it('should handle arbitrary header names', () => {
      const headers = AuthHeaders.custom('X-Custom-Auth', 'secret');
      expect(headers).toEqual({ 'X-Custom-Auth': 'secret' });
    });
  });
});
