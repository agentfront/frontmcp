/**
 * Auth Options Schema Tests
 *
 * Tests for all Zod schemas in the auth options module:
 * - shared.schemas.ts (publicAccessConfig, localSigningConfig, providerConfig,
 *   tokenStorageConfig, tokenRefreshConfig, consentConfig, federatedAuthConfig,
 *   incrementalAuthConfig)
 * - schema.ts (authOptionsSchema)
 * - public.schema.ts (publicAuthOptionsSchema)
 * - transparent.schema.ts (transparentAuthOptionsSchema)
 * - orchestrated.schema.ts (localAuthSchema, remoteAuthSchema)
 */

import {
  publicAccessConfigSchema,
  localSigningConfigSchema,
  providerConfigSchema,
  tokenStorageConfigSchema,
  tokenRefreshConfigSchema,
  consentConfigSchema,
  federatedAuthConfigSchema,
  incrementalAuthConfigSchema,
  remoteProviderConfigSchema,
  skippedAppBehaviorSchema,
} from '../shared.schemas';

import { authOptionsSchema } from '../schema';
import { publicAuthOptionsSchema } from '../public.schema';
import { transparentAuthOptionsSchema } from '../transparent.schema';
import { localAuthSchema, remoteAuthSchema } from '../orchestrated.schema';

// ============================================
// publicAccessConfigSchema
// ============================================

describe('publicAccessConfigSchema', () => {
  it('should apply defaults when given an empty object', () => {
    const result = publicAccessConfigSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tools).toBe('all');
      expect(result.data.prompts).toBe('all');
      expect(result.data.rateLimit).toBe(60);
    }
  });

  it('should accept tools="all" and prompts="all"', () => {
    const result = publicAccessConfigSchema.safeParse({
      tools: 'all',
      prompts: 'all',
      rateLimit: 120,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tools).toBe('all');
      expect(result.data.prompts).toBe('all');
      expect(result.data.rateLimit).toBe(120);
    }
  });

  it('should accept tools as a string array whitelist', () => {
    const result = publicAccessConfigSchema.safeParse({
      tools: ['tool_a', 'tool_b'],
      prompts: ['prompt_x'],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tools).toEqual(['tool_a', 'tool_b']);
      expect(result.data.prompts).toEqual(['prompt_x']);
    }
  });

  it('should reject invalid type for tools', () => {
    const result = publicAccessConfigSchema.safeParse({ tools: 123 });
    expect(result.success).toBe(false);
  });

  it('should reject invalid type for prompts', () => {
    const result = publicAccessConfigSchema.safeParse({ prompts: true });
    expect(result.success).toBe(false);
  });

  it('should reject invalid type for rateLimit', () => {
    const result = publicAccessConfigSchema.safeParse({ rateLimit: 'fast' });
    expect(result.success).toBe(false);
  });
});

// ============================================
// localSigningConfigSchema
// ============================================

describe('localSigningConfigSchema', () => {
  it('should accept an empty object (all fields optional)', () => {
    const result = localSigningConfigSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.signKey).toBeUndefined();
      expect(result.data.jwks).toBeUndefined();
      expect(result.data.issuer).toBeUndefined();
    }
  });

  it('should accept valid data with optional fields populated', () => {
    const result = localSigningConfigSchema.safeParse({
      issuer: 'https://my-server.com',
      jwks: { keys: [{ kty: 'RSA', n: 'abc', e: 'AQAB' }] },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.issuer).toBe('https://my-server.com');
      expect(result.data.jwks).toEqual({ keys: [{ kty: 'RSA', n: 'abc', e: 'AQAB' }] });
    }
  });

  it('should accept signKey as a JWK object', () => {
    const result = localSigningConfigSchema.safeParse({
      signKey: { kty: 'EC', crv: 'P-256', x: 'abc', y: 'def', d: 'ghi' },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.signKey).toEqual({ kty: 'EC', crv: 'P-256', x: 'abc', y: 'def', d: 'ghi' });
    }
  });

  it('should accept signKey as a Uint8Array', () => {
    const keyBytes = new Uint8Array([1, 2, 3, 4]);
    const result = localSigningConfigSchema.safeParse({
      signKey: keyBytes,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.signKey).toBeDefined();
    }
  });

  it('should reject signKey as a plain string', () => {
    const result = localSigningConfigSchema.safeParse({ signKey: 'not-a-key' });
    expect(result.success).toBe(false);
  });
});

// ============================================
// providerConfigSchema
// ============================================

describe('providerConfigSchema', () => {
  it('should accept an empty object with dcrEnabled defaulting to false', () => {
    const result = providerConfigSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.dcrEnabled).toBe(false);
      expect(result.data.name).toBeUndefined();
      expect(result.data.id).toBeUndefined();
    }
  });

  it('should accept valid data with all fields', () => {
    const result = providerConfigSchema.safeParse({
      name: 'My Provider',
      id: 'provider-1',
      jwks: { keys: [{ kty: 'RSA', e: 'AQAB', n: 'modulus' }] },
      jwksUri: 'https://provider.com/.well-known/jwks.json',
      dcrEnabled: true,
      authEndpoint: 'https://provider.com/authorize',
      tokenEndpoint: 'https://provider.com/token',
      registrationEndpoint: 'https://provider.com/register',
      userInfoEndpoint: 'https://provider.com/userinfo',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('My Provider');
      expect(result.data.id).toBe('provider-1');
      expect(result.data.dcrEnabled).toBe(true);
      expect(result.data.authEndpoint).toBe('https://provider.com/authorize');
      expect(result.data.tokenEndpoint).toBe('https://provider.com/token');
      expect(result.data.registrationEndpoint).toBe('https://provider.com/register');
      expect(result.data.userInfoEndpoint).toBe('https://provider.com/userinfo');
    }
  });

  it('should reject invalid URL for jwksUri', () => {
    const result = providerConfigSchema.safeParse({ jwksUri: 'not-a-url' });
    expect(result.success).toBe(false);
  });

  it('should reject invalid URL for authEndpoint', () => {
    const result = providerConfigSchema.safeParse({ authEndpoint: 'not-a-url' });
    expect(result.success).toBe(false);
  });

  it('should reject invalid URL for tokenEndpoint', () => {
    const result = providerConfigSchema.safeParse({ tokenEndpoint: 'bad' });
    expect(result.success).toBe(false);
  });

  it('should reject invalid URL for registrationEndpoint', () => {
    const result = providerConfigSchema.safeParse({ registrationEndpoint: 'nope' });
    expect(result.success).toBe(false);
  });

  it('should reject invalid URL for userInfoEndpoint', () => {
    const result = providerConfigSchema.safeParse({ userInfoEndpoint: 'invalid' });
    expect(result.success).toBe(false);
  });
});

// ============================================
// remoteProviderConfigSchema
// ============================================

describe('remoteProviderConfigSchema', () => {
  it('should accept valid data with required provider URL', () => {
    const result = remoteProviderConfigSchema.safeParse({
      provider: 'https://auth.example.com',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.provider).toBe('https://auth.example.com');
      expect(result.data.dcrEnabled).toBe(false);
    }
  });

  it('should reject missing provider URL', () => {
    const result = remoteProviderConfigSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('should reject invalid provider URL', () => {
    const result = remoteProviderConfigSchema.safeParse({ provider: 'not-a-url' });
    expect(result.success).toBe(false);
  });

  it('should accept all optional fields', () => {
    const result = remoteProviderConfigSchema.safeParse({
      provider: 'https://auth.example.com',
      name: 'Auth0',
      id: 'auth0',
      clientId: 'client-123',
      clientSecret: 'secret-abc',
      scopes: ['openid', 'profile'],
      dcrEnabled: true,
      authEndpoint: 'https://auth.example.com/authorize',
      tokenEndpoint: 'https://auth.example.com/token',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.clientId).toBe('client-123');
      expect(result.data.scopes).toEqual(['openid', 'profile']);
      expect(result.data.dcrEnabled).toBe(true);
    }
  });
});

// ============================================
// tokenStorageConfigSchema
// ============================================

describe('tokenStorageConfigSchema', () => {
  it('should accept the literal "memory"', () => {
    const result = tokenStorageConfigSchema.safeParse('memory');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe('memory');
    }
  });

  it('should accept a redis object configuration', () => {
    const result = tokenStorageConfigSchema.safeParse({
      redis: {
        host: 'localhost',
        port: 6379,
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        redis: expect.objectContaining({ host: 'localhost', port: 6379 }),
      });
    }
  });

  it('should reject invalid string values', () => {
    const result = tokenStorageConfigSchema.safeParse('redis');
    expect(result.success).toBe(false);
  });

  it('should reject a redis config with missing host', () => {
    const result = tokenStorageConfigSchema.safeParse({ redis: {} });
    expect(result.success).toBe(false);
  });

  it('should reject a number', () => {
    const result = tokenStorageConfigSchema.safeParse(42);
    expect(result.success).toBe(false);
  });
});

// ============================================
// tokenRefreshConfigSchema
// ============================================

describe('tokenRefreshConfigSchema', () => {
  it('should apply defaults when given an empty object', () => {
    const result = tokenRefreshConfigSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.enabled).toBe(true);
      expect(result.data.skewSeconds).toBe(60);
    }
  });

  it('should accept custom values', () => {
    const result = tokenRefreshConfigSchema.safeParse({
      enabled: false,
      skewSeconds: 120,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.enabled).toBe(false);
      expect(result.data.skewSeconds).toBe(120);
    }
  });

  it('should reject invalid type for enabled', () => {
    const result = tokenRefreshConfigSchema.safeParse({ enabled: 'yes' });
    expect(result.success).toBe(false);
  });

  it('should reject invalid type for skewSeconds', () => {
    const result = tokenRefreshConfigSchema.safeParse({ skewSeconds: 'fast' });
    expect(result.success).toBe(false);
  });
});

// ============================================
// skippedAppBehaviorSchema
// ============================================

describe('skippedAppBehaviorSchema', () => {
  it('should accept "anonymous"', () => {
    const result = skippedAppBehaviorSchema.safeParse('anonymous');
    expect(result.success).toBe(true);
  });

  it('should accept "require-auth"', () => {
    const result = skippedAppBehaviorSchema.safeParse('require-auth');
    expect(result.success).toBe(true);
  });

  it('should reject invalid values', () => {
    const result = skippedAppBehaviorSchema.safeParse('allow');
    expect(result.success).toBe(false);
  });
});

// ============================================
// consentConfigSchema
// ============================================

describe('consentConfigSchema', () => {
  it('should apply all defaults when given an empty object', () => {
    const result = consentConfigSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.enabled).toBe(false);
      expect(result.data.groupByApp).toBe(true);
      expect(result.data.showDescriptions).toBe(true);
      expect(result.data.allowSelectAll).toBe(true);
      expect(result.data.requireSelection).toBe(true);
      expect(result.data.rememberConsent).toBe(true);
      expect(result.data.customMessage).toBeUndefined();
      expect(result.data.excludedTools).toBeUndefined();
      expect(result.data.defaultSelectedTools).toBeUndefined();
    }
  });

  it('should accept all fields specified', () => {
    const result = consentConfigSchema.safeParse({
      enabled: true,
      groupByApp: false,
      showDescriptions: false,
      allowSelectAll: false,
      requireSelection: false,
      customMessage: 'Please select tools',
      rememberConsent: false,
      excludedTools: ['essential_tool'],
      defaultSelectedTools: ['default_tool'],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.enabled).toBe(true);
      expect(result.data.groupByApp).toBe(false);
      expect(result.data.showDescriptions).toBe(false);
      expect(result.data.allowSelectAll).toBe(false);
      expect(result.data.requireSelection).toBe(false);
      expect(result.data.customMessage).toBe('Please select tools');
      expect(result.data.rememberConsent).toBe(false);
      expect(result.data.excludedTools).toEqual(['essential_tool']);
      expect(result.data.defaultSelectedTools).toEqual(['default_tool']);
    }
  });

  it('should accept partial fields and apply remaining defaults', () => {
    const result = consentConfigSchema.safeParse({
      enabled: true,
      customMessage: 'Pick your tools',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.enabled).toBe(true);
      expect(result.data.customMessage).toBe('Pick your tools');
      expect(result.data.groupByApp).toBe(true);
      expect(result.data.showDescriptions).toBe(true);
    }
  });

  it('should reject invalid type for enabled', () => {
    const result = consentConfigSchema.safeParse({ enabled: 'yes' });
    expect(result.success).toBe(false);
  });
});

// ============================================
// federatedAuthConfigSchema
// ============================================

describe('federatedAuthConfigSchema', () => {
  it('should default stateValidation to "strict"', () => {
    const result = federatedAuthConfigSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.stateValidation).toBe('strict');
    }
  });

  it('should accept "strict" value', () => {
    const result = federatedAuthConfigSchema.safeParse({ stateValidation: 'strict' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.stateValidation).toBe('strict');
    }
  });

  it('should accept "format" value', () => {
    const result = federatedAuthConfigSchema.safeParse({ stateValidation: 'format' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.stateValidation).toBe('format');
    }
  });

  it('should reject invalid stateValidation values', () => {
    const result = federatedAuthConfigSchema.safeParse({ stateValidation: 'loose' });
    expect(result.success).toBe(false);
  });
});

// ============================================
// incrementalAuthConfigSchema
// ============================================

describe('incrementalAuthConfigSchema', () => {
  it('should apply all defaults when given an empty object', () => {
    const result = incrementalAuthConfigSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.enabled).toBe(true);
      expect(result.data.skippedAppBehavior).toBe('anonymous');
      expect(result.data.allowSkip).toBe(true);
      expect(result.data.showAllAppsAtOnce).toBe(true);
    }
  });

  it('should accept custom values', () => {
    const result = incrementalAuthConfigSchema.safeParse({
      enabled: false,
      skippedAppBehavior: 'require-auth',
      allowSkip: false,
      showAllAppsAtOnce: false,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.enabled).toBe(false);
      expect(result.data.skippedAppBehavior).toBe('require-auth');
      expect(result.data.allowSkip).toBe(false);
      expect(result.data.showAllAppsAtOnce).toBe(false);
    }
  });

  it('should reject invalid skippedAppBehavior', () => {
    const result = incrementalAuthConfigSchema.safeParse({
      skippedAppBehavior: 'invalid-behavior',
    });
    expect(result.success).toBe(false);
  });

  it('should reject invalid type for enabled', () => {
    const result = incrementalAuthConfigSchema.safeParse({ enabled: 'yes' });
    expect(result.success).toBe(false);
  });
});

// ============================================
// authOptionsSchema (unified, from schema.ts)
// ============================================

describe('authOptionsSchema', () => {
  it('should accept valid public mode options', () => {
    const result = authOptionsSchema.safeParse({ mode: 'public' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.mode).toBe('public');
    }
  });

  it('should accept valid transparent mode options', () => {
    const result = authOptionsSchema.safeParse({
      mode: 'transparent',
      provider: 'https://auth.example.com',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.mode).toBe('transparent');
    }
  });

  it('should accept valid local mode options', () => {
    const result = authOptionsSchema.safeParse({ mode: 'local' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.mode).toBe('local');
    }
  });

  it('should accept valid remote mode options', () => {
    const result = authOptionsSchema.safeParse({
      mode: 'remote',
      provider: 'https://auth.example.com',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.mode).toBe('remote');
    }
  });

  it('should reject an invalid mode', () => {
    const result = authOptionsSchema.safeParse({ mode: 'invalid' });
    expect(result.success).toBe(false);
  });

  it('should reject an empty object (no mode)', () => {
    const result = authOptionsSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('should reject transparent mode without provider', () => {
    const result = authOptionsSchema.safeParse({ mode: 'transparent' });
    expect(result.success).toBe(false);
  });

  it('should reject remote mode without provider', () => {
    const result = authOptionsSchema.safeParse({ mode: 'remote' });
    expect(result.success).toBe(false);
  });
});

// ============================================
// publicAuthOptionsSchema (from public.schema.ts)
// ============================================

describe('publicAuthOptionsSchema', () => {
  it('should accept valid public mode with only mode specified', () => {
    const result = publicAuthOptionsSchema.safeParse({ mode: 'public' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.mode).toBe('public');
      expect(result.data.sessionTtl).toBe(3600);
      expect(result.data.anonymousScopes).toEqual(['anonymous']);
    }
  });

  it('should accept custom sessionTtl and anonymousScopes', () => {
    const result = publicAuthOptionsSchema.safeParse({
      mode: 'public',
      sessionTtl: 7200,
      anonymousScopes: ['read', 'anonymous'],
      issuer: 'https://my-server.com',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sessionTtl).toBe(7200);
      expect(result.data.anonymousScopes).toEqual(['read', 'anonymous']);
      expect(result.data.issuer).toBe('https://my-server.com');
    }
  });

  it('should accept publicAccess sub-config', () => {
    const result = publicAuthOptionsSchema.safeParse({
      mode: 'public',
      publicAccess: {
        tools: ['tool_a'],
        prompts: 'all',
        rateLimit: 30,
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.publicAccess?.tools).toEqual(['tool_a']);
      expect(result.data.publicAccess?.prompts).toBe('all');
      expect(result.data.publicAccess?.rateLimit).toBe(30);
    }
  });

  it('should accept jwks and signKey fields', () => {
    const result = publicAuthOptionsSchema.safeParse({
      mode: 'public',
      jwks: { keys: [{ kty: 'RSA', e: 'AQAB', n: 'modulus' }] },
      signKey: { kty: 'RSA', d: 'private', e: 'AQAB', n: 'modulus' },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.jwks).toBeDefined();
      expect(result.data.signKey).toBeDefined();
    }
  });

  it('should reject missing mode', () => {
    const result = publicAuthOptionsSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('should reject wrong mode literal', () => {
    const result = publicAuthOptionsSchema.safeParse({ mode: 'transparent' });
    expect(result.success).toBe(false);
  });
});

// ============================================
// transparentAuthOptionsSchema (from transparent.schema.ts)
// ============================================

describe('transparentAuthOptionsSchema', () => {
  it('should accept valid transparent mode with required provider URL', () => {
    const result = transparentAuthOptionsSchema.safeParse({
      mode: 'transparent',
      provider: 'https://auth.example.com',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.mode).toBe('transparent');
      expect(result.data.provider).toBe('https://auth.example.com');
      expect(result.data.requiredScopes).toEqual([]);
      expect(result.data.allowAnonymous).toBe(false);
      expect(result.data.anonymousScopes).toEqual(['anonymous']);
    }
  });

  it('should reject missing provider URL', () => {
    const result = transparentAuthOptionsSchema.safeParse({ mode: 'transparent' });
    expect(result.success).toBe(false);
  });

  it('should reject invalid provider URL', () => {
    const result = transparentAuthOptionsSchema.safeParse({
      mode: 'transparent',
      provider: 'not-a-valid-url',
    });
    expect(result.success).toBe(false);
  });

  it('should accept custom requiredScopes and allowAnonymous', () => {
    const result = transparentAuthOptionsSchema.safeParse({
      mode: 'transparent',
      provider: 'https://auth.example.com',
      requiredScopes: ['read', 'write'],
      allowAnonymous: true,
      anonymousScopes: ['guest'],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.requiredScopes).toEqual(['read', 'write']);
      expect(result.data.allowAnonymous).toBe(true);
      expect(result.data.anonymousScopes).toEqual(['guest']);
    }
  });

  it('should accept expectedAudience as a string', () => {
    const result = transparentAuthOptionsSchema.safeParse({
      mode: 'transparent',
      provider: 'https://auth.example.com',
      expectedAudience: 'https://api.example.com',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.expectedAudience).toBe('https://api.example.com');
    }
  });

  it('should accept expectedAudience as a string array', () => {
    const result = transparentAuthOptionsSchema.safeParse({
      mode: 'transparent',
      provider: 'https://auth.example.com',
      expectedAudience: ['https://api1.example.com', 'https://api2.example.com'],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.expectedAudience).toEqual(['https://api1.example.com', 'https://api2.example.com']);
    }
  });

  it('should accept clientId, clientSecret, and scopes', () => {
    const result = transparentAuthOptionsSchema.safeParse({
      mode: 'transparent',
      provider: 'https://auth.example.com',
      clientId: 'my-client',
      clientSecret: 'my-secret',
      scopes: ['openid', 'profile'],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.clientId).toBe('my-client');
      expect(result.data.clientSecret).toBe('my-secret');
      expect(result.data.scopes).toEqual(['openid', 'profile']);
    }
  });

  it('should accept providerConfig sub-object', () => {
    const result = transparentAuthOptionsSchema.safeParse({
      mode: 'transparent',
      provider: 'https://auth.example.com',
      providerConfig: {
        id: 'auth0',
        name: 'Auth0',
        dcrEnabled: true,
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.providerConfig?.id).toBe('auth0');
      expect(result.data.providerConfig?.name).toBe('Auth0');
      expect(result.data.providerConfig?.dcrEnabled).toBe(true);
    }
  });

  it('should accept publicAccess when allowAnonymous is set', () => {
    const result = transparentAuthOptionsSchema.safeParse({
      mode: 'transparent',
      provider: 'https://auth.example.com',
      allowAnonymous: true,
      publicAccess: {
        tools: ['public_tool'],
        prompts: 'all',
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.publicAccess?.tools).toEqual(['public_tool']);
    }
  });
});

// ============================================
// localAuthSchema (from orchestrated.schema.ts)
// ============================================

describe('localAuthSchema', () => {
  it('should accept minimal local mode with defaults', () => {
    const result = localAuthSchema.safeParse({ mode: 'local' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.mode).toBe('local');
      expect(result.data.tokenStorage).toBe('memory');
      expect(result.data.allowDefaultPublic).toBe(false);
      expect(result.data.anonymousScopes).toEqual(['anonymous']);
    }
  });

  it('should accept local mode with all shared auth fields', () => {
    const result = localAuthSchema.safeParse({
      mode: 'local',
      local: { issuer: 'https://local.example.com' },
      tokenStorage: 'memory',
      allowDefaultPublic: true,
      anonymousScopes: ['read'],
      publicAccess: { tools: 'all', prompts: 'all' },
      consent: { enabled: true },
      federatedAuth: { stateValidation: 'format' },
      refresh: { enabled: false, skewSeconds: 30 },
      expectedAudience: 'https://api.example.com',
      incrementalAuth: { enabled: false, skippedAppBehavior: 'require-auth' },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.mode).toBe('local');
      expect(result.data.allowDefaultPublic).toBe(true);
      expect(result.data.local?.issuer).toBe('https://local.example.com');
      expect(result.data.consent?.enabled).toBe(true);
      expect(result.data.federatedAuth?.stateValidation).toBe('format');
      expect(result.data.refresh?.enabled).toBe(false);
      expect(result.data.refresh?.skewSeconds).toBe(30);
      expect(result.data.expectedAudience).toBe('https://api.example.com');
      expect(result.data.incrementalAuth?.enabled).toBe(false);
    }
  });

  it('should accept tokenStorage as redis config', () => {
    const result = localAuthSchema.safeParse({
      mode: 'local',
      tokenStorage: {
        redis: { host: 'redis.example.com', port: 6380 },
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tokenStorage).toEqual({
        redis: expect.objectContaining({ host: 'redis.example.com', port: 6380 }),
      });
    }
  });

  it('should reject wrong mode literal', () => {
    const result = localAuthSchema.safeParse({ mode: 'remote' });
    expect(result.success).toBe(false);
  });

  it('should accept cimd config', () => {
    const result = localAuthSchema.safeParse({
      mode: 'local',
      cimd: { enabled: true },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.cimd?.enabled).toBe(true);
    }
  });

  it('should accept expectedAudience as array', () => {
    const result = localAuthSchema.safeParse({
      mode: 'local',
      expectedAudience: ['aud1', 'aud2'],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.expectedAudience).toEqual(['aud1', 'aud2']);
    }
  });
});

// ============================================
// remoteAuthSchema (from orchestrated.schema.ts)
// ============================================

describe('remoteAuthSchema', () => {
  it('should accept minimal remote mode with required provider', () => {
    const result = remoteAuthSchema.safeParse({
      mode: 'remote',
      provider: 'https://auth.example.com',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.mode).toBe('remote');
      expect(result.data.provider).toBe('https://auth.example.com');
      expect(result.data.tokenStorage).toBe('memory');
      expect(result.data.allowDefaultPublic).toBe(false);
      expect(result.data.anonymousScopes).toEqual(['anonymous']);
    }
  });

  it('should reject missing provider URL', () => {
    const result = remoteAuthSchema.safeParse({ mode: 'remote' });
    expect(result.success).toBe(false);
  });

  it('should reject invalid provider URL', () => {
    const result = remoteAuthSchema.safeParse({
      mode: 'remote',
      provider: 'not-a-url',
    });
    expect(result.success).toBe(false);
  });

  it('should accept remote mode with full configuration', () => {
    const result = remoteAuthSchema.safeParse({
      mode: 'remote',
      provider: 'https://auth.example.com',
      clientId: 'client-abc',
      clientSecret: 'secret-xyz',
      scopes: ['openid', 'email'],
      providerConfig: {
        id: 'auth0',
        name: 'Auth0',
        dcrEnabled: false,
        authEndpoint: 'https://auth.example.com/authorize',
        tokenEndpoint: 'https://auth.example.com/token',
      },
      local: { issuer: 'https://my-mcp.example.com' },
      tokenStorage: 'memory',
      allowDefaultPublic: true,
      anonymousScopes: ['public'],
      publicAccess: { tools: ['tool_1'], prompts: 'all', rateLimit: 100 },
      consent: { enabled: true, groupByApp: false },
      federatedAuth: { stateValidation: 'strict' },
      refresh: { enabled: true, skewSeconds: 90 },
      expectedAudience: 'https://api.example.com',
      incrementalAuth: {
        enabled: true,
        skippedAppBehavior: 'anonymous',
        allowSkip: true,
        showAllAppsAtOnce: false,
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.mode).toBe('remote');
      expect(result.data.clientId).toBe('client-abc');
      expect(result.data.providerConfig?.id).toBe('auth0');
      expect(result.data.allowDefaultPublic).toBe(true);
      expect(result.data.consent?.enabled).toBe(true);
      expect(result.data.incrementalAuth?.showAllAppsAtOnce).toBe(false);
    }
  });

  it('should reject wrong mode literal', () => {
    const result = remoteAuthSchema.safeParse({
      mode: 'local',
      provider: 'https://auth.example.com',
    });
    expect(result.success).toBe(false);
  });

  it('should accept cimd config', () => {
    const result = remoteAuthSchema.safeParse({
      mode: 'remote',
      provider: 'https://auth.example.com',
      cimd: {
        enabled: true,
        cache: { type: 'memory' },
        security: { blockPrivateIPs: true },
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.cimd?.enabled).toBe(true);
    }
  });
});
