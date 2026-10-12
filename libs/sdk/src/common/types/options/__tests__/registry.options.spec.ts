import 'reflect-metadata';

import { App } from '../../../decorators/app.decorator';
import { frontMcpMetadataSchema } from '../../../metadata/front-mcp.metadata';
import { mcpRegistryOptionsSchema, toRegistryAuthRecord } from '../registry';

const ED25519_PUBLIC_KEY = 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=';
const ECDSA_P384_PUBLIC_KEY = 'AgkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQ==';

@App({ id: 'registry-options-app', name: 'registry-options-app' })
class RegistryOptionsApp {}

describe('mcpRegistryOptionsSchema', () => {
  it('accepts a complete configuration', () => {
    const options = {
      name: 'com.acme/weather',
      description: 'Forecasts and alerts for any city',
      repository: { url: 'https://github.com/acme/weather-mcp', source: 'github' as const, subfolder: 'server' },
      publicKey: ED25519_PUBLIC_KEY,
      publicKeyEnv: 'ACME_REGISTRY_KEY',
      serverCard: true,
      aiCatalog: false,
    };
    expect(mcpRegistryOptionsSchema.parse(options)).toEqual(options);
  });

  it('accepts an empty configuration, which serves only the domain proof', () => {
    expect(mcpRegistryOptionsSchema.parse({})).toEqual({});
  });

  it.each(['com.acme/weather', 'io.github.octo-cat/my_server.v2', 'acme/w1'])('accepts the name %s', (name) => {
    expect(mcpRegistryOptionsSchema.safeParse({ name, description: 'd' }).success).toBe(true);
  });

  it.each([
    ['without a namespace', 'weather'],
    ['with an empty server part', 'com.acme/'],
    ['with a namespace starting with a dot', '.acme/weather'],
    ['with a server part ending with a dash', 'com.acme/weather-'],
    ['with two slashes', 'com.acme/weather/extra'],
    ['with a space', 'com acme/weather'],
    ['with one-character parts', 'a/b'],
    ['with a one-character server part', 'com.acme/w'],
    ['over 200 characters', `com.acme/${'w'.repeat(200)}`],
  ])('rejects a name %s', (_case, name) => {
    expect(mcpRegistryOptionsSchema.safeParse({ name, description: 'd' }).success).toBe(false);
  });

  it('requires a description when a name is set', () => {
    const result = mcpRegistryOptionsSchema.safeParse({ name: 'com.acme/weather' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['description']);
  });

  it('accepts a description of 1 to 100 characters only', () => {
    expect(mcpRegistryOptionsSchema.safeParse({ description: 'd'.repeat(100) }).success).toBe(true);
    expect(mcpRegistryOptionsSchema.safeParse({ description: 'd'.repeat(101) }).success).toBe(false);
    expect(mcpRegistryOptionsSchema.safeParse({ description: '' }).success).toBe(false);
  });

  it('accepts a base64 Ed25519 key and whole records', () => {
    for (const publicKey of [
      ED25519_PUBLIC_KEY,
      `v=MCPv1; k=ed25519; p=${ED25519_PUBLIC_KEY}`,
      `v=MCPv1;k=ecdsap384;p=${ECDSA_P384_PUBLIC_KEY}`,
    ]) {
      expect(mcpRegistryOptionsSchema.safeParse({ publicKey }).success).toBe(true);
    }
  });

  it.each([
    ['a 64-hex-character private key seed', '9f'.repeat(32)],
    ['a key of 31 bytes', 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBw=='],
    ['a key of 33 bytes', 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcH'],
    ['unpadded base64', ED25519_PUBLIC_KEY.slice(0, -1)],
    ['a P-384 key without its record', ECDSA_P384_PUBLIC_KEY],
    ['a record with an unknown algorithm', `v=MCPv1; k=rsa; p=${ED25519_PUBLIC_KEY}`],
    ['a record whose key length does not match its algorithm', `v=MCPv1; k=ecdsap384; p=${ED25519_PUBLIC_KEY}`],
    ['an empty string', ''],
  ])('rejects %s as publicKey', (_case, publicKey) => {
    expect(mcpRegistryOptionsSchema.safeParse({ publicKey }).success).toBe(false);
  });

  it('accepts an environment variable name as publicKeyEnv, and nothing else', () => {
    expect(mcpRegistryOptionsSchema.safeParse({ publicKeyEnv: '_ACME_KEY_2' }).success).toBe(true);
    expect(mcpRegistryOptionsSchema.safeParse({ publicKeyEnv: '2_KEY' }).success).toBe(false);
    expect(mcpRegistryOptionsSchema.safeParse({ publicKeyEnv: 'ACME-KEY' }).success).toBe(false);
  });

  it('validates the repository', () => {
    const repository = { url: 'https://gitlab.com/acme/weather', source: 'gitlab' };
    expect(mcpRegistryOptionsSchema.safeParse({ repository }).success).toBe(true);
    expect(mcpRegistryOptionsSchema.safeParse({ repository: { ...repository, source: 'bitbucket' } }).success).toBe(
      false,
    );
    expect(mcpRegistryOptionsSchema.safeParse({ repository: { ...repository, url: 'not a url' } }).success).toBe(false);
  });
});

describe('toRegistryAuthRecord', () => {
  it('wraps a bare Ed25519 key in a record', () => {
    expect(toRegistryAuthRecord(` ${ED25519_PUBLIC_KEY}\n`)).toBe(`v=MCPv1; k=ed25519; p=${ED25519_PUBLIC_KEY}`);
  });

  it('returns a whole record as given', () => {
    const record = `v=MCPv1;k=ecdsap384;p=${ECDSA_P384_PUBLIC_KEY}`;
    expect(toRegistryAuthRecord(record)).toBe(record);
  });

  it('returns undefined for a value that is no key', () => {
    expect(toRegistryAuthRecord('not-a-key')).toBeUndefined();
  });
});

describe('@FrontMcp({ registry })', () => {
  const baseConfig = { info: { name: 'weather', version: '1.0.0' }, apps: [RegistryOptionsApp] };

  it('keeps the registry option through the server schema', () => {
    const registry = { name: 'com.acme/weather', description: 'Forecasts', publicKey: ED25519_PUBLIC_KEY };
    expect(frontMcpMetadataSchema.parse({ ...baseConfig, registry }).registry).toEqual(registry);
  });

  it('refuses an invalid registry option at startup', () => {
    expect(() => frontMcpMetadataSchema.parse({ ...baseConfig, registry: { publicKey: 'nope' } })).toThrow(
      /registry.publicKey/,
    );
  });
});
