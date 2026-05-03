import * as plugin from '..';

describe('public package surface', () => {
  it('default export is the SkilledOpenApiPlugin class', () => {
    expect(typeof plugin.default).toBe('function');
    expect(plugin.default.name).toBe('SkilledOpenApiPlugin');
  });

  it('named exports include the plugin class, config, and options schema', () => {
    expect(plugin.SkilledOpenApiPlugin).toBe(plugin.default);
    expect(plugin.SkilledOpenApiConfig).toBeDefined();
    expect(plugin.skilledOpenApiPluginOptionsSchema).toBeDefined();
  });

  it('options schema parses a minimal valid input', () => {
    const result = plugin.skilledOpenApiPluginOptionsSchema.safeParse({
      source: { type: 'static', path: '/x' },
    });
    expect(result.success).toBe(true);
  });

  it('options schema rejects empty input', () => {
    const result = plugin.skilledOpenApiPluginOptionsSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('options schema parses an npm source variant', () => {
    const r = plugin.skilledOpenApiPluginOptionsSchema.safeParse({
      source: { type: 'npm', packageName: '@acme/bundle' },
    });
    expect(r.success).toBe(true);
  });

  it('options schema parses a saas source variant', () => {
    const r = plugin.skilledOpenApiPluginOptionsSchema.safeParse({
      source: {
        type: 'saas',
        endpoint: 'https://cloud.example.dev/v1/x',
        authToken: 'tok',
        expectedAudience: 'aud',
        jwksUrl: 'https://cloud.example.dev/jwks',
        expectedIssuer: 'https://cloud.example.dev',
      },
    });
    expect(r.success).toBe(true);
  });

  it('options schema rejects malformed saas endpoint URLs', () => {
    const r = plugin.skilledOpenApiPluginOptionsSchema.safeParse({
      source: {
        type: 'saas',
        endpoint: 'not a url',
        authToken: 'tok',
        expectedAudience: 'aud',
        jwksUrl: 'https://cloud.example.dev/jwks',
        expectedIssuer: 'https://cloud.example.dev',
      },
    });
    expect(r.success).toBe(false);
  });

  it('options schema parses outbound + signature key inputs', () => {
    const r = plugin.skilledOpenApiPluginOptionsSchema.safeParse({
      source: { type: 'static', path: '/x' },
      trustedKeys: [
        { keyId: 'k1', alg: 'RS256', publicKeyPem: '-----BEGIN PUBLIC KEY-----\nXXX\n-----END PUBLIC KEY-----' },
      ],
      outbound: {
        allowPrivateNetworks: false,
        maxConcurrencyPerHost: 5,
        defaultTimeoutMs: 1000,
        defaultMaxResponseBytes: 4096,
        allowHttp: false,
      },
    });
    expect(r.success).toBe(true);
  });
});
