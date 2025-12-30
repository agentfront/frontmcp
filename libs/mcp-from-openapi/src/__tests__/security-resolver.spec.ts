/**
 * Tests for SecurityResolver class
 */

import { SecurityResolver, createSecurityContext, SecurityContext } from '../security-resolver';
import type { ParameterMapper, SecurityParameterInfo } from '../types';

describe('SecurityResolver', () => {
  let resolver: SecurityResolver;

  beforeEach(() => {
    resolver = new SecurityResolver();
  });

  describe('resolve', () => {
    it('should return empty resolved security for no mappers', async () => {
      const result = await resolver.resolve([], {});

      expect(result.headers).toEqual({});
      expect(result.query).toEqual({});
      expect(result.cookies).toEqual({});
    });

    it('should skip non-security parameters', async () => {
      const mappers: ParameterMapper[] = [
        { inputKey: 'id', key: 'id', type: 'path' },
        { inputKey: 'limit', key: 'limit', type: 'query' },
      ];

      const result = await resolver.resolve(mappers, {});

      expect(result.headers).toEqual({});
    });

    it('should add client certificate from context', async () => {
      const context: SecurityContext = {
        clientCertificate: {
          cert: 'test-cert',
          key: 'test-key',
        },
      };

      const result = await resolver.resolve([], context);

      expect(result.clientCertificate).toEqual({
        cert: 'test-cert',
        key: 'test-key',
      });
    });

    it('should add cookies from context', async () => {
      const context: SecurityContext = {
        cookies: { session: 'abc123', auth: 'xyz789' },
      };

      const result = await resolver.resolve([], context);

      expect(result.cookies).toEqual({
        session: 'abc123',
        auth: 'xyz789',
      });
    });

    it('should resolve bearer auth to header', async () => {
      const mappers: ParameterMapper[] = [
        {
          inputKey: 'Authorization',
          key: 'Authorization',
          type: 'header',
          security: {
            scheme: 'bearerAuth',
            type: 'http',
            httpScheme: 'bearer',
          },
        },
      ];

      const context: SecurityContext = {
        jwt: 'my-jwt-token',
      };

      const result = await resolver.resolve(mappers, context);

      expect(result.headers['Authorization']).toBe('Bearer my-jwt-token');
    });

    it('should resolve basic auth to header', async () => {
      const mappers: ParameterMapper[] = [
        {
          inputKey: 'Authorization',
          key: 'Authorization',
          type: 'header',
          security: {
            scheme: 'basicAuth',
            type: 'http',
            httpScheme: 'basic',
          },
        },
      ];

      const context: SecurityContext = {
        basic: 'dXNlcjpwYXNz', // base64 encoded user:pass
      };

      const result = await resolver.resolve(mappers, context);

      expect(result.headers['Authorization']).toBe('Basic dXNlcjpwYXNz');
    });

    it('should resolve digest auth to header', async () => {
      const mappers: ParameterMapper[] = [
        {
          inputKey: 'Authorization',
          key: 'Authorization',
          type: 'header',
          security: {
            scheme: 'digestAuth',
            type: 'http',
            httpScheme: 'digest',
          },
        },
      ];

      const context: SecurityContext = {
        digest: {
          username: 'user',
          password: 'pass',
          realm: 'example.com',
          nonce: 'abc123',
          uri: '/api/resource',
          response: 'computed-hash',
          opaque: 'opaque-value',
          qop: 'auth',
          nc: '00000001',
          cnonce: 'client-nonce',
        },
      };

      const result = await resolver.resolve(mappers, context);

      expect(result.headers['Authorization']).toContain('Digest');
      expect(result.headers['Authorization']).toContain('username="user"');
      expect(result.headers['Authorization']).toContain('realm="example.com"');
    });

    it('should resolve API key to header', async () => {
      const mappers: ParameterMapper[] = [
        {
          inputKey: 'X-API-Key',
          key: 'X-API-Key',
          type: 'header',
          security: {
            scheme: 'apiKey',
            type: 'apiKey',
            apiKeyName: 'X-API-Key',
            apiKeyIn: 'header',
          },
        },
      ];

      const context: SecurityContext = {
        apiKey: 'my-api-key',
      };

      const result = await resolver.resolve(mappers, context);

      expect(result.headers['X-API-Key']).toBe('my-api-key');
    });

    it('should resolve API key to query', async () => {
      const mappers: ParameterMapper[] = [
        {
          inputKey: 'api_key',
          key: 'api_key',
          type: 'query',
          security: {
            scheme: 'apiKey',
            type: 'apiKey',
            apiKeyName: 'api_key',
            apiKeyIn: 'query',
          },
        },
      ];

      const context: SecurityContext = {
        apiKey: 'my-api-key',
      };

      const result = await resolver.resolve(mappers, context);

      expect(result.query['api_key']).toBe('my-api-key');
    });

    it('should resolve API key to cookie', async () => {
      const mappers: ParameterMapper[] = [
        {
          inputKey: 'session',
          key: 'session',
          type: 'cookie',
          security: {
            scheme: 'apiKey',
            type: 'apiKey',
            apiKeyName: 'session',
            apiKeyIn: 'cookie',
          },
        },
      ];

      const context: SecurityContext = {
        apiKey: 'session-value',
      };

      const result = await resolver.resolve(mappers, context);

      expect(result.cookies['session']).toBe('session-value');
    });

    it('should resolve OAuth2 auth to header', async () => {
      const mappers: ParameterMapper[] = [
        {
          inputKey: 'Authorization',
          key: 'Authorization',
          type: 'header',
          security: {
            scheme: 'oauth2',
            type: 'oauth2',
          },
        },
      ];

      const context: SecurityContext = {
        oauth2Token: 'oauth-access-token',
      };

      const result = await resolver.resolve(mappers, context);

      expect(result.headers['Authorization']).toBe('Bearer oauth-access-token');
    });

    it('should resolve OpenID Connect auth to header', async () => {
      const mappers: ParameterMapper[] = [
        {
          inputKey: 'Authorization',
          key: 'Authorization',
          type: 'header',
          security: {
            scheme: 'oidc',
            type: 'openIdConnect',
          },
        },
      ];

      const context: SecurityContext = {
        oauth2Token: 'oidc-token',
      };

      const result = await resolver.resolve(mappers, context);

      expect(result.headers['Authorization']).toBe('Bearer oidc-token');
    });

    it('should use custom resolver', async () => {
      const mappers: ParameterMapper[] = [
        {
          inputKey: 'Authorization',
          key: 'Authorization',
          type: 'header',
          security: {
            scheme: 'customAuth',
            type: 'http',
            httpScheme: 'bearer',
          },
        },
      ];

      const context: SecurityContext = {
        customResolver: (security) => {
          if (security.scheme === 'customAuth') {
            return 'CustomToken my-custom-token';
          }
          return '';
        },
      };

      const result = await resolver.resolve(mappers, context);

      expect(result.headers['Authorization']).toBe('CustomToken my-custom-token');
    });

    it('should use named API keys', async () => {
      const mappers: ParameterMapper[] = [
        {
          inputKey: 'X-Client-Id',
          key: 'X-Client-Id',
          type: 'header',
          security: {
            scheme: 'clientId',
            type: 'apiKey',
            apiKeyName: 'X-Client-Id',
            apiKeyIn: 'header',
          },
        },
      ];

      const context: SecurityContext = {
        apiKeys: { 'X-Client-Id': 'client-123' },
      };

      const result = await resolver.resolve(mappers, context);

      expect(result.headers['X-Client-Id']).toBe('client-123');
    });

    it('should use custom headers for API key', async () => {
      const mappers: ParameterMapper[] = [
        {
          inputKey: 'X-Custom-Auth',
          key: 'X-Custom-Auth',
          type: 'header',
          security: {
            scheme: 'customApiKey',
            type: 'apiKey',
            apiKeyName: 'X-Custom-Auth',
            apiKeyIn: 'header',
          },
        },
      ];

      const context: SecurityContext = {
        customHeaders: { 'X-Custom-Auth': 'custom-value' },
      };

      const result = await resolver.resolve(mappers, context);

      expect(result.headers['X-Custom-Auth']).toBe('custom-value');
    });

    it('should detect signature-based auth and set requiresSignature', async () => {
      const mappers: ParameterMapper[] = [
        {
          inputKey: 'Authorization',
          key: 'Authorization',
          type: 'header',
          security: {
            scheme: 'aws4-hmac-sha256',
            type: 'http',
            httpScheme: 'bearer',
          },
        },
      ];

      const result = await resolver.resolve(mappers, {});

      expect(result.requiresSignature).toBe(true);
      expect(result.signatureInfo).toEqual({
        scheme: 'aws4-hmac-sha256',
      });
    });

    it('should handle unknown security type', async () => {
      const mappers: ParameterMapper[] = [
        {
          inputKey: 'Auth',
          key: 'Auth',
          type: 'header',
          security: {
            scheme: 'unknownScheme',
            type: 'unknown' as any,
          },
        },
      ];

      const result = await resolver.resolve(mappers, {});

      expect(result.headers).toEqual({});
    });

    it('should handle unknown HTTP scheme', async () => {
      const mappers: ParameterMapper[] = [
        {
          inputKey: 'Auth',
          key: 'Auth',
          type: 'header',
          security: {
            scheme: 'customScheme',
            type: 'http',
            httpScheme: 'vapid',
          },
        },
      ];

      const context: SecurityContext = {
        customHeaders: { 'X-VAPID': 'vapid-auth-value' },
      };

      const result = await resolver.resolve(mappers, context);

      expect(result.headers['Auth']).toBe('vapid-auth-value');
    });

    it('should skip when auth value is not available', async () => {
      const mappers: ParameterMapper[] = [
        {
          inputKey: 'Authorization',
          key: 'Authorization',
          type: 'header',
          security: {
            scheme: 'bearerAuth',
            type: 'http',
            httpScheme: 'bearer',
          },
        },
      ];

      const result = await resolver.resolve(mappers, {}); // No jwt provided

      expect(result.headers['Authorization']).toBeUndefined();
    });
  });

  describe('checkMissingSecurity', () => {
    it('should return empty array when all security is resolved', async () => {
      const mappers: ParameterMapper[] = [
        {
          inputKey: 'Authorization',
          key: 'Authorization',
          type: 'header',
          security: {
            scheme: 'bearerAuth',
            type: 'http',
            httpScheme: 'bearer',
          },
        },
      ];

      const context: SecurityContext = {
        jwt: 'my-token',
      };

      const missing = await resolver.checkMissingSecurity(mappers, context);

      expect(missing).toEqual([]);
    });

    it('should return missing security schemes', async () => {
      const mappers: ParameterMapper[] = [
        {
          inputKey: 'Authorization',
          key: 'Authorization',
          type: 'header',
          security: {
            scheme: 'bearerAuth',
            type: 'http',
            httpScheme: 'bearer',
          },
        },
        {
          inputKey: 'X-API-Key',
          key: 'X-API-Key',
          type: 'header',
          security: {
            scheme: 'apiKey',
            type: 'apiKey',
            apiKeyName: 'X-API-Key',
            apiKeyIn: 'header',
          },
        },
      ];

      const context: SecurityContext = {
        jwt: 'my-token',
        // apiKey not provided
      };

      const missing = await resolver.checkMissingSecurity(mappers, context);

      expect(missing).toContain('apiKey');
    });

    it('should skip non-security parameters', async () => {
      const mappers: ParameterMapper[] = [{ inputKey: 'id', key: 'id', type: 'path' }];

      const missing = await resolver.checkMissingSecurity(mappers, {});

      expect(missing).toEqual([]);
    });
  });

  describe('signRequest', () => {
    it('should call signature generator and add headers', async () => {
      const mappers: ParameterMapper[] = [
        {
          inputKey: 'Authorization',
          key: 'Authorization',
          type: 'header',
          security: {
            scheme: 'hmac-signature',
            type: 'http',
            httpScheme: 'bearer',
          },
        },
      ];

      const context: SecurityContext = {
        signatureGenerator: (_data, _security) => {
          return `Signature keyId="test",signature="computed-signature"`;
        },
      };

      const signatureData = {
        method: 'GET',
        url: 'https://api.example.com/data',
        headers: { 'Content-Type': 'application/json' },
      };

      const signedHeaders = await resolver.signRequest(mappers, signatureData, context);

      expect(signedHeaders['Authorization']).toBe('Signature keyId="test",signature="computed-signature"');
      expect(signedHeaders['Content-Type']).toBe('application/json');
    });

    it('should throw error when signatureGenerator is missing', async () => {
      const mappers: ParameterMapper[] = [
        {
          inputKey: 'Authorization',
          key: 'Authorization',
          type: 'header',
          security: {
            scheme: 'hmac-signature',
            type: 'http',
            httpScheme: 'bearer',
          },
        },
      ];

      const signatureData = {
        method: 'GET',
        url: 'https://api.example.com/data',
        headers: {},
      };

      await expect(resolver.signRequest(mappers, signatureData, {})).rejects.toThrow('no signatureGenerator provided');
    });

    it('should skip non-signature security parameters', async () => {
      const mappers: ParameterMapper[] = [
        {
          inputKey: 'Authorization',
          key: 'Authorization',
          type: 'header',
          security: {
            scheme: 'bearerAuth',
            type: 'http',
            httpScheme: 'bearer',
          },
        },
      ];

      const context: SecurityContext = {
        signatureGenerator: () => 'signed',
      };

      const signatureData = {
        method: 'GET',
        url: 'https://api.example.com/data',
        headers: { existing: 'header' },
      };

      const signedHeaders = await resolver.signRequest(mappers, signatureData, context);

      // Should not modify headers for non-signature schemes
      expect(signedHeaders['Authorization']).toBeUndefined();
      expect(signedHeaders['existing']).toBe('header');
    });
  });

  describe('Digest Auth Formatting', () => {
    it('should format digest auth with minimal fields', async () => {
      const mappers: ParameterMapper[] = [
        {
          inputKey: 'Authorization',
          key: 'Authorization',
          type: 'header',
          security: {
            scheme: 'digestAuth',
            type: 'http',
            httpScheme: 'digest',
          },
        },
      ];

      const context: SecurityContext = {
        digest: {
          username: 'user',
          password: 'pass',
        },
      };

      const result = await resolver.resolve(mappers, context);

      expect(result.headers['Authorization']).toBe('Digest username="user"');
    });
  });

  describe('Edge Cases', () => {
    it('should handle async custom resolver', async () => {
      const mappers: ParameterMapper[] = [
        {
          inputKey: 'Authorization',
          key: 'Authorization',
          type: 'header',
          security: {
            scheme: 'asyncAuth',
            type: 'http',
            httpScheme: 'bearer',
          },
        },
      ];

      const context: SecurityContext = {
        customResolver: async (_security) => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return 'AsyncToken async-value';
        },
      };

      const result = await resolver.resolve(mappers, context);

      expect(result.headers['Authorization']).toBe('AsyncToken async-value');
    });

    it('should handle custom resolver returning undefined', async () => {
      const mappers: ParameterMapper[] = [
        {
          inputKey: 'Authorization',
          key: 'Authorization',
          type: 'header',
          security: {
            scheme: 'bearerAuth',
            type: 'http',
            httpScheme: 'bearer',
          },
        },
      ];

      const context: SecurityContext = {
        jwt: 'fallback-token',
        customResolver: async () => undefined, // Returning undefined should fall back to default
      };

      const result = await resolver.resolve(mappers, context);

      expect(result.headers['Authorization']).toBe('Bearer fallback-token');
    });

    it('should handle missing httpScheme defaulting to bearer', async () => {
      const mappers: ParameterMapper[] = [
        {
          inputKey: 'Authorization',
          key: 'Authorization',
          type: 'header',
          security: {
            scheme: 'httpAuth',
            type: 'http',
            // httpScheme not provided - should default to bearer
          },
        },
      ];

      const context: SecurityContext = {
        jwt: 'my-token',
      };

      const result = await resolver.resolve(mappers, context);

      expect(result.headers['Authorization']).toBe('Bearer my-token');
    });
  });
});

describe('createSecurityContext', () => {
  it('should create context from partial auth', () => {
    const context = createSecurityContext({
      jwt: 'my-jwt',
      apiKey: 'my-api-key',
    });

    expect(context.jwt).toBe('my-jwt');
    expect(context.apiKey).toBe('my-api-key');
  });

  it('should handle all auth types', () => {
    const customResolver = (_security: SecurityParameterInfo) => 'custom';

    const context = createSecurityContext({
      jwt: 'jwt',
      basic: 'basic',
      apiKey: 'apiKey',
      oauth2Token: 'oauth2',
      customResolver,
    });

    expect(context.jwt).toBe('jwt');
    expect(context.basic).toBe('basic');
    expect(context.apiKey).toBe('apiKey');
    expect(context.oauth2Token).toBe('oauth2');
    expect(context.customResolver).toBe(customResolver);
  });

  it('should handle empty auth', () => {
    const context = createSecurityContext({});

    expect(context.jwt).toBeUndefined();
    expect(context.apiKey).toBeUndefined();
  });
});
