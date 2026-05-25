// file: libs/adapters/src/skills/__tests__/deploy-manifest.schema.spec.ts

import { crossValidateManifest, deployManifestSchema, type DeployManifest } from '../deploy/deploy-manifest.schema';

const baseValid: DeployManifest = {
  version: 1,
  name: 'acme-mcp',
  runtime: {
    target: 'cloudflare-worker',
    compatibilityDate: '2026-05-01',
  },
  server: {
    info: { name: 'acme-mcp', version: '1.0.0' },
  },
  specs: './openapi/',
  skills: { source: './skills/' },
  bindings: {
    durableObjects: [{ binding: 'SESSIONS', className: 'SessionDO' }],
    kvNamespaces: [{ binding: 'REPLAY_NONCE', id: 'kv-id-here' }],
  },
  signing: {
    algorithm: 'ed25519',
    trustRoots: [{ kid: 'prod-2026-05', publicKeySecret: 'TRUSTED_PUBKEY_PROD' }],
    replay: { windowSeconds: 300, nonceKv: 'REPLAY_NONCE' },
  },
  auth: { provider: 'none' },
  secrets: [{ name: 'TRUSTED_PUBKEY_PROD', required: true }],
};

describe('deployManifestSchema', () => {
  describe('happy path', () => {
    it('accepts the minimal valid manifest', () => {
      const parsed = deployManifestSchema.parse(baseValid);
      expect(parsed.version).toBe(1);
      expect(parsed.name).toBe('acme-mcp');
      expect(parsed.runtime.target).toBe('cloudflare-worker');
    });

    it('accepts $schema URL pointer', () => {
      const parsed = deployManifestSchema.parse({
        ...baseValid,
        $schema: 'https://schemas.agentfront.dev/frontmcp-deploy/v1.json',
      });
      expect(parsed.$schema).toBe('https://schemas.agentfront.dev/frontmcp-deploy/v1.json');
    });

    it('accepts a list of explicit spec sources alongside a single path', () => {
      const parsed = deployManifestSchema.parse({
        ...baseValid,
        specs: [
          './openapi/acme.yaml',
          { id: 'billing', spec: './openapi/billing.yaml', baseUrl: 'https://billing.acme.com' },
        ],
      });
      expect(Array.isArray(parsed.specs)).toBe(true);
    });

    it('accepts the four binding shapes', () => {
      const parsed = deployManifestSchema.parse({
        ...baseValid,
        bindings: {
          durableObjects: [{ binding: 'SESSIONS', className: 'SessionDO', scriptName: 'acme-mcp' }],
          d1Databases: [{ binding: 'AUDIT', databaseName: 'acme-audit', databaseId: 'd1-id' }],
          kvNamespaces: [
            { binding: 'REPLAY_NONCE', id: 'kv-nonce' },
            { binding: 'BUNDLE_CACHE', id: 'kv-bundle' },
          ],
          r2Buckets: [{ binding: 'SKILL_DATA', bucketName: 'acme-skill-data' }],
          vars: { LOG_LEVEL: 'info' },
        },
      });
      expect(parsed.bindings.d1Databases).toHaveLength(1);
      expect(parsed.bindings.kvNamespaces).toHaveLength(2);
    });

    it('accepts the four auth provider shapes', () => {
      // frontegg
      expect(() =>
        deployManifestSchema.parse({
          ...baseValid,
          auth: {
            provider: 'frontegg',
            frontegg: { tenantResolver: 'subdomain', audience: 'acme', issuerSecret: 'FE_ISSUER' },
          },
          secrets: [...(baseValid.secrets ?? []), { name: 'FE_ISSUER', required: true }],
        }),
      ).not.toThrow();

      // oauth
      expect(() =>
        deployManifestSchema.parse({
          ...baseValid,
          auth: { provider: 'oauth', oauth: { issuer: 'https://issuer.example.com', audience: 'acme' } },
        }),
      ).not.toThrow();

      // apiKey
      expect(() =>
        deployManifestSchema.parse({
          ...baseValid,
          auth: { provider: 'apiKey', apiKey: { header: 'X-API-Key', allowlistSecret: 'KEYS' } },
          secrets: [...(baseValid.secrets ?? []), { name: 'KEYS', required: true }],
        }),
      ).not.toThrow();

      // none (already in baseValid)
      expect(() => deployManifestSchema.parse(baseValid)).not.toThrow();
    });

    it('accepts a full environments overlay', () => {
      const parsed = deployManifestSchema.parse({
        ...baseValid,
        tags: [{ name: 'public', description: 'Always exposed' }, { name: 'admin' }],
        skills: { source: './skills/', alwaysLoad: ['std-helpers'] },
        environments: {
          staging: {
            skills: { tags: { include: ['public'] } },
            bindings: { vars: { LOG_LEVEL: 'debug' } },
          },
          production: {
            skills: { tags: { include: ['public'], exclude: ['admin'] } },
          },
        },
      });
      expect(parsed.environments?.staging).toBeDefined();
      expect(parsed.environments?.production).toBeDefined();
    });

    it('applies the default `skills.source = ./skills/` when only an alwaysLoad list is given', () => {
      const parsed = deployManifestSchema.parse({ ...baseValid, skills: { alwaysLoad: ['std-helpers'] } });
      expect(parsed.skills.source).toBe('./skills/');
    });

    it('accepts compatibilityFlags array', () => {
      const parsed = deployManifestSchema.parse({
        ...baseValid,
        runtime: { ...baseValid.runtime, compatibilityFlags: ['nodejs_compat'] },
      });
      expect(parsed.runtime.compatibilityFlags).toEqual(['nodejs_compat']);
    });
  });

  describe('rejections', () => {
    it('rejects a non-literal version', () => {
      expect(() => deployManifestSchema.parse({ ...baseValid, version: 2 })).toThrow();
      expect(() => deployManifestSchema.parse({ ...baseValid, version: '1' as unknown as 1 })).toThrow();
    });

    it('rejects unknown top-level keys (strict)', () => {
      expect(() => deployManifestSchema.parse({ ...baseValid, surprise: true })).toThrow();
    });

    it('rejects unknown keys inside bindings (strict)', () => {
      expect(() =>
        deployManifestSchema.parse({
          ...baseValid,
          bindings: { ...baseValid.bindings, unknownField: 'x' },
        }),
      ).toThrow();
    });

    it('rejects malformed compatibilityDate', () => {
      expect(() =>
        deployManifestSchema.parse({
          ...baseValid,
          runtime: { ...baseValid.runtime, compatibilityDate: 'May 1, 2026' },
        }),
      ).toThrow();
    });

    it('rejects non-SCREAMING_SNAKE_CASE secret names', () => {
      expect(() =>
        deployManifestSchema.parse({ ...baseValid, secrets: [{ name: 'lowercase', required: true }] }),
      ).toThrow();
      expect(() =>
        deployManifestSchema.parse({ ...baseValid, secrets: [{ name: 'mixed-Case', required: true }] }),
      ).toThrow();
    });

    it('rejects invalid binding names', () => {
      expect(() =>
        deployManifestSchema.parse({
          ...baseValid,
          bindings: {
            ...baseValid.bindings,
            kvNamespaces: [{ binding: 'lowercase', id: 'kv-id' }],
          },
        }),
      ).toThrow();
    });

    it('rejects invalid auth discriminator', () => {
      expect(() => deployManifestSchema.parse({ ...baseValid, auth: { provider: 'magic' } as never })).toThrow();
    });

    it('rejects empty trustRoots', () => {
      expect(() =>
        deployManifestSchema.parse({
          ...baseValid,
          signing: { ...baseValid.signing, trustRoots: [] },
        }),
      ).toThrow();
    });

    it('rejects a project name with invalid characters', () => {
      expect(() => deployManifestSchema.parse({ ...baseValid, name: 'has space' })).toThrow();
      expect(() => deployManifestSchema.parse({ ...baseValid, name: '_leadingUnderscore' })).toThrow();
    });
  });
});

describe('crossValidateManifest', () => {
  it('returns ok for a fully consistent manifest', () => {
    const parsed = deployManifestSchema.parse(baseValid);
    expect(crossValidateManifest(parsed)).toEqual({ ok: true });
  });

  it('flags an undeclared signing trust-root secret', () => {
    const parsed = deployManifestSchema.parse({ ...baseValid, secrets: [] });
    const result = crossValidateManifest(parsed);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('TRUSTED_PUBKEY_PROD'))).toBe(true);
    }
  });

  it('flags an undeclared frontegg issuer secret', () => {
    const parsed = deployManifestSchema.parse({
      ...baseValid,
      auth: {
        provider: 'frontegg',
        frontegg: { tenantResolver: 'subdomain', audience: 'acme', issuerSecret: 'FE_ISSUER' },
      },
      // FE_ISSUER deliberately NOT declared in secrets.
    });
    const result = crossValidateManifest(parsed);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('FE_ISSUER'))).toBe(true);
      expect(result.errors.some((e) => e.includes('auth.frontegg.issuerSecret'))).toBe(true);
    }
  });

  it('flags an undeclared apiKey allowlist secret', () => {
    const parsed = deployManifestSchema.parse({
      ...baseValid,
      auth: { provider: 'apiKey', apiKey: { header: 'X-API-Key', allowlistSecret: 'KEYS' } },
    });
    const result = crossValidateManifest(parsed);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('KEYS'))).toBe(true);
    }
  });

  it('flags a replay nonceKv that is not declared in bindings.kvNamespaces', () => {
    const parsed = deployManifestSchema.parse({
      ...baseValid,
      signing: {
        ...baseValid.signing,
        replay: { windowSeconds: 300, nonceKv: 'MISSING_KV' },
      },
    });
    const result = crossValidateManifest(parsed);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('MISSING_KV'))).toBe(true);
      expect(result.errors.some((e) => e.includes('kvNamespaces'))).toBe(true);
    }
  });

  it('flags an alwaysLoad id that is not kebab-case', () => {
    const parsed = deployManifestSchema.parse({
      ...baseValid,
      skills: { source: './skills/', alwaysLoad: ['ValidName', 'has_underscore'] },
    });
    const result = crossValidateManifest(parsed);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('ValidName'))).toBe(true);
      expect(result.errors.some((e) => e.includes('has_underscore'))).toBe(true);
    }
  });

  it('flags a tag filter that references an undeclared tag', () => {
    const parsed = deployManifestSchema.parse({
      ...baseValid,
      tags: [{ name: 'public' }],
      skills: { source: './skills/', tags: { include: ['public', 'nonexistent'] } },
    });
    const result = crossValidateManifest(parsed);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('nonexistent'))).toBe(true);
    }
  });

  it('skips tag validation when no tags[] is declared (treats anything as allowed)', () => {
    const parsed = deployManifestSchema.parse({
      ...baseValid,
      skills: { source: './skills/', tags: { include: ['public'] } },
    });
    const result = crossValidateManifest(parsed);
    expect(result.ok).toBe(true);
  });

  it('aggregates multiple errors in a single pass', () => {
    const parsed = deployManifestSchema.parse({
      ...baseValid,
      secrets: [],
      signing: {
        ...baseValid.signing,
        replay: { windowSeconds: 300, nonceKv: 'MISSING_KV' },
      },
    });
    const result = crossValidateManifest(parsed);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // At least: undeclared trust-root secret + missing replay KV
      expect(result.errors.length).toBeGreaterThanOrEqual(2);
    }
  });
});
