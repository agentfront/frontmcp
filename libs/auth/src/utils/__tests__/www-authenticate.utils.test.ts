/**
 * WWW-Authenticate Header Builder Tests
 *
 * Tests for RFC 9728 and RFC 6750 compliant header building and parsing.
 */
import {
  buildWwwAuthenticate,
  buildPrmUrl,
  buildUnauthorizedHeader,
  buildInvalidTokenHeader,
  buildInsufficientScopeHeader,
  buildInvalidRequestHeader,
  parseWwwAuthenticate,
} from '../www-authenticate.utils';

describe('buildWwwAuthenticate', () => {
  it('should return bare "Bearer" when called with empty options', () => {
    expect(buildWwwAuthenticate({})).toBe('Bearer');
  });

  it('should return bare "Bearer" when called with no arguments', () => {
    expect(buildWwwAuthenticate()).toBe('Bearer');
  });

  it('should include resource_metadata when resourceMetadataUrl is set', () => {
    const result = buildWwwAuthenticate({
      resourceMetadataUrl: 'https://api.example.com/.well-known/oauth-protected-resource',
    });
    expect(result).toBe('Bearer resource_metadata="https://api.example.com/.well-known/oauth-protected-resource"');
  });

  it('should include realm parameter', () => {
    const result = buildWwwAuthenticate({ realm: 'my-api' });
    expect(result).toBe('Bearer realm="my-api"');
  });

  it('should include error=invalid_request', () => {
    const result = buildWwwAuthenticate({ error: 'invalid_request' });
    expect(result).toBe('Bearer error="invalid_request"');
  });

  it('should include error=invalid_token', () => {
    const result = buildWwwAuthenticate({ error: 'invalid_token' });
    expect(result).toBe('Bearer error="invalid_token"');
  });

  it('should include error=insufficient_scope', () => {
    const result = buildWwwAuthenticate({ error: 'insufficient_scope' });
    expect(result).toBe('Bearer error="insufficient_scope"');
  });

  it('should include error_description', () => {
    const result = buildWwwAuthenticate({
      error: 'invalid_token',
      errorDescription: 'Token expired',
    });
    expect(result).toContain('error_description="Token expired"');
  });

  it('should include error_uri', () => {
    const result = buildWwwAuthenticate({
      error: 'invalid_request',
      errorUri: 'https://docs.example.com/errors/invalid_request',
    });
    expect(result).toContain('error_uri="https://docs.example.com/errors/invalid_request"');
  });

  it('should include scope as string', () => {
    const result = buildWwwAuthenticate({ scope: 'read write' });
    expect(result).toBe('Bearer scope="read write"');
  });

  it('should join scope array with spaces', () => {
    const result = buildWwwAuthenticate({ scope: ['read', 'write', 'admin'] });
    expect(result).toBe('Bearer scope="read write admin"');
  });

  it('should combine all options in correct order', () => {
    const result = buildWwwAuthenticate({
      resourceMetadataUrl: 'https://api.example.com/.well-known/oauth-protected-resource',
      realm: 'my-api',
      error: 'insufficient_scope',
      errorDescription: 'Need more permissions',
      errorUri: 'https://docs.example.com/scopes',
      scope: ['read', 'write'],
    });

    // Verify all parts are present
    expect(result).toContain('Bearer');
    expect(result).toContain('resource_metadata="https://api.example.com/.well-known/oauth-protected-resource"');
    expect(result).toContain('realm="my-api"');
    expect(result).toContain('error="insufficient_scope"');
    expect(result).toContain('error_description="Need more permissions"');
    expect(result).toContain('error_uri="https://docs.example.com/scopes"');
    expect(result).toContain('scope="read write"');

    // Verify ordering: resource_metadata comes first after Bearer
    const resourceIdx = result.indexOf('resource_metadata');
    const realmIdx = result.indexOf('realm');
    const errorIdx = result.indexOf('error=');
    expect(resourceIdx).toBeLessThan(realmIdx);
    expect(realmIdx).toBeLessThan(errorIdx);
  });

  describe('string escaping', () => {
    it('should escape backslashes in quoted values', () => {
      const result = buildWwwAuthenticate({
        realm: 'my\\realm',
      });
      expect(result).toBe('Bearer realm="my\\\\realm"');
    });

    it('should escape double quotes in quoted values', () => {
      const result = buildWwwAuthenticate({
        errorDescription: 'Token "invalid"',
      });
      expect(result).toContain('error_description="Token \\"invalid\\""');
    });

    it('should escape both backslashes and quotes', () => {
      const result = buildWwwAuthenticate({
        realm: 'my\\"realm',
      });
      expect(result).toContain('realm="my\\\\\\"realm"');
    });
  });
});

describe('buildPrmUrl', () => {
  it('should build PRM URL with base URL and paths', () => {
    const result = buildPrmUrl('https://api.example.com', '/mcp', '/v1');
    expect(result).toBe('https://api.example.com/.well-known/oauth-protected-resource/mcp/v1');
  });

  it('should handle empty entry path and route base', () => {
    const result = buildPrmUrl('https://api.example.com', '', '');
    expect(result).toBe('https://api.example.com/.well-known/oauth-protected-resource');
  });

  it('should handle slash-only entry path', () => {
    const result = buildPrmUrl('https://api.example.com', '/', '/api');
    expect(result).toBe('https://api.example.com/.well-known/oauth-protected-resource/api');
  });

  it('should handle slash-only route base', () => {
    const result = buildPrmUrl('https://api.example.com', '/mcp', '/');
    expect(result).toBe('https://api.example.com/.well-known/oauth-protected-resource/mcp');
  });

  it('should normalize paths without leading slashes', () => {
    const result = buildPrmUrl('https://api.example.com', 'mcp', 'v1');
    expect(result).toBe('https://api.example.com/.well-known/oauth-protected-resource/mcp/v1');
  });

  it('should strip trailing slashes from path segments', () => {
    const result = buildPrmUrl('https://api.example.com', '/mcp/', '/v1/');
    expect(result).toBe('https://api.example.com/.well-known/oauth-protected-resource/mcp/v1');
  });

  it('should strip multiple trailing slashes', () => {
    const result = buildPrmUrl('https://api.example.com', '/mcp///', '/v1///');
    expect(result).toBe('https://api.example.com/.well-known/oauth-protected-resource/mcp/v1');
  });
});

describe('buildUnauthorizedHeader', () => {
  it('should build header with resource_metadata URL', () => {
    const prmUrl = 'https://api.example.com/.well-known/oauth-protected-resource';
    const result = buildUnauthorizedHeader(prmUrl);
    expect(result).toBe(`Bearer resource_metadata="${prmUrl}"`);
  });
});

describe('buildInvalidTokenHeader', () => {
  const prmUrl = 'https://api.example.com/.well-known/oauth-protected-resource';

  it('should build header with default description', () => {
    const result = buildInvalidTokenHeader(prmUrl);
    expect(result).toContain('error="invalid_token"');
    expect(result).toContain('error_description="The access token is invalid or expired"');
    expect(result).toContain(`resource_metadata="${prmUrl}"`);
  });

  it('should build header with custom description', () => {
    const result = buildInvalidTokenHeader(prmUrl, 'Token revoked');
    expect(result).toContain('error="invalid_token"');
    expect(result).toContain('error_description="Token revoked"');
  });
});

describe('buildInsufficientScopeHeader', () => {
  const prmUrl = 'https://api.example.com/.well-known/oauth-protected-resource';

  it('should build header with required scopes', () => {
    const result = buildInsufficientScopeHeader(prmUrl, ['read', 'write']);
    expect(result).toContain('error="insufficient_scope"');
    expect(result).toContain('scope="read write"');
    expect(result).toContain('error_description="The request requires higher privileges"');
    expect(result).toContain(`resource_metadata="${prmUrl}"`);
  });

  it('should build header with custom description', () => {
    const result = buildInsufficientScopeHeader(prmUrl, ['admin'], 'Admin access required');
    expect(result).toContain('scope="admin"');
    expect(result).toContain('error_description="Admin access required"');
  });

  it('should handle empty scopes array', () => {
    const result = buildInsufficientScopeHeader(prmUrl, []);
    expect(result).toContain('error="insufficient_scope"');
    // Empty scope array joins to empty string, scope param still included with empty value
    expect(result).toContain('scope=""');
  });
});

describe('buildInvalidRequestHeader', () => {
  const prmUrl = 'https://api.example.com/.well-known/oauth-protected-resource';

  it('should build header with default description', () => {
    const result = buildInvalidRequestHeader(prmUrl);
    expect(result).toContain('error="invalid_request"');
    expect(result).toContain('error_description="The request is missing required parameters"');
    expect(result).toContain(`resource_metadata="${prmUrl}"`);
  });

  it('should build header with custom description', () => {
    const result = buildInvalidRequestHeader(prmUrl, 'Missing Authorization header');
    expect(result).toContain('error="invalid_request"');
    expect(result).toContain('error_description="Missing Authorization header"');
  });
});

describe('parseWwwAuthenticate', () => {
  it('should parse bare Bearer header', () => {
    const result = parseWwwAuthenticate('Bearer');
    expect(result).toEqual({});
  });

  it('should parse header with resource_metadata', () => {
    const header = 'Bearer resource_metadata="https://api.example.com/.well-known/oauth-protected-resource"';
    const result = parseWwwAuthenticate(header);
    expect(result.resourceMetadataUrl).toBe('https://api.example.com/.well-known/oauth-protected-resource');
  });

  it('should parse header with realm', () => {
    const header = 'Bearer realm="my-api"';
    const result = parseWwwAuthenticate(header);
    expect(result.realm).toBe('my-api');
  });

  it('should parse header with error', () => {
    const header = 'Bearer error="invalid_token"';
    const result = parseWwwAuthenticate(header);
    expect(result.error).toBe('invalid_token');
  });

  it('should parse header with error_description', () => {
    const header = 'Bearer error_description="Token expired"';
    const result = parseWwwAuthenticate(header);
    expect(result.errorDescription).toBe('Token expired');
  });

  it('should parse header with error_uri', () => {
    const header = 'Bearer error_uri="https://docs.example.com/errors"';
    const result = parseWwwAuthenticate(header);
    expect(result.errorUri).toBe('https://docs.example.com/errors');
  });

  it('should parse header with scope', () => {
    const header = 'Bearer scope="read write admin"';
    const result = parseWwwAuthenticate(header);
    expect(result.scope).toBe('read write admin');
  });

  it('should round-trip all fields correctly', () => {
    const original = {
      resourceMetadataUrl: 'https://api.example.com/.well-known/oauth-protected-resource',
      realm: 'my-api',
      error: 'insufficient_scope' as const,
      errorDescription: 'Need more permissions',
      errorUri: 'https://docs.example.com/scopes',
      scope: 'read write',
    };

    const header = buildWwwAuthenticate(original);
    const parsed = parseWwwAuthenticate(header);

    expect(parsed.resourceMetadataUrl).toBe(original.resourceMetadataUrl);
    expect(parsed.realm).toBe(original.realm);
    expect(parsed.error).toBe(original.error);
    expect(parsed.errorDescription).toBe(original.errorDescription);
    expect(parsed.errorUri).toBe(original.errorUri);
    expect(parsed.scope).toBe(original.scope);
  });

  it('should round-trip values with embedded quotes correctly', () => {
    const original = {
      realm: 'my-realm',
      errorDescription: 'The token is expired',
    };

    const header = buildWwwAuthenticate({
      ...original,
      error: 'invalid_request',
    });
    const parsed = parseWwwAuthenticate(header);

    expect(parsed.realm).toBe(original.realm);
    expect(parsed.errorDescription).toBe(original.errorDescription);
  });

  it('should parse values with escaped characters in the header', () => {
    // Manually crafted header with escaped quotes inside a value
    const header = 'Bearer realm="my-realm", error_description="Token \\"expired\\""';
    const parsed = parseWwwAuthenticate(header);

    expect(parsed.realm).toBe('my-realm');
    expect(parsed.errorDescription).toBe('Token "expired"');
  });

  it('should return empty object for non-Bearer scheme', () => {
    const result = parseWwwAuthenticate('Basic realm="my-api"');
    expect(result).toEqual({});
  });

  it('should return empty object for Digest scheme', () => {
    const result = parseWwwAuthenticate('Digest realm="my-api", nonce="abc123"');
    expect(result).toEqual({});
  });

  it('should return empty object for empty string', () => {
    const result = parseWwwAuthenticate('');
    expect(result).toEqual({});
  });

  it('should handle case-insensitive Bearer prefix', () => {
    const result = parseWwwAuthenticate('bearer resource_metadata="https://example.com/prm"');
    expect(result.resourceMetadataUrl).toBe('https://example.com/prm');
  });

  it('should handle BEARER in uppercase', () => {
    const result = parseWwwAuthenticate('BEARER realm="test"');
    expect(result.realm).toBe('test');
  });

  it('should handle malformed input with no equals sign', () => {
    const result = parseWwwAuthenticate('Bearer malformed_param');
    // Should not crash, just skip the malformed param
    expect(result).toEqual({});
  });

  it('should handle malformed input with no quotes', () => {
    const result = parseWwwAuthenticate('Bearer key=value');
    // Should skip values not in quotes
    expect(result).toEqual({});
  });
});
