import * as yaml from 'js-yaml';

import { generateRsaKeyPair, rsaSignBase64Url } from '@frontmcp/utils';

import type { ResolvedBundle } from '../bundle/bundle.types';
import { OverlayParseError, parseOverlay } from '../bundle/overlay-parser';
import { bundleDigest, canonicalize, verifyBundleSignature } from '../security/bundle-signature';

const baseBundle = {
  schemaVersion: 1,
  bundleId: 'acme:prod',
  version: '2026.05.01-1',
  generatedAt: '2026-05-01T12:00:00.000Z',
  sourceDigest: 'b'.repeat(64),
  services: [{ id: 'billing', baseUrl: 'https://api.example.com' }],
  authBindings: { default: { kind: 'bearer', vaultRef: 'stripe-key' } },
  skills: [
    {
      id: 'invoices',
      name: 'Invoices',
      description: 'Issue and manage invoices.',
      instructions: '# Invoices',
      operationIds: ['createInvoice'],
    },
  ],
  operations: {
    createInvoice: {
      operationId: 'createInvoice',
      serviceId: 'billing',
      httpMethod: 'POST',
      pathTemplate: '/v1/invoices',
      inputSchema: { type: 'object', properties: { amount: { type: 'number' } } },
      outputSchema: { type: 'object', properties: { id: { type: 'string' } } },
      mapper: [],
      authBindingRef: 'default',
    },
  },
};

describe('parseOverlay', () => {
  it('parses a bare bundle object directly (object input)', () => {
    const bundle = parseOverlay({ kind: 'object', content: baseBundle });
    expect(bundle.bundleId).toBe('acme:prod');
    expect(bundle.skills[0].id).toBe('invoices');
  });

  it('parses an overlay wrapping the bundle under info.x-frontmcp-bundle', () => {
    const overlay = { overlay: '1.0.0', info: { 'x-frontmcp-bundle': baseBundle } };
    const bundle = parseOverlay({ kind: 'object', content: overlay });
    expect(bundle.bundleId).toBe('acme:prod');
  });

  it('parses an overlay where the extension is at root', () => {
    const overlay = { overlay: '1.0.0', 'x-frontmcp-bundle': baseBundle };
    const bundle = parseOverlay({ kind: 'object', content: overlay });
    expect(bundle.bundleId).toBe('acme:prod');
  });

  it('parses YAML input', () => {
    const yamlContent = yaml.dump(baseBundle);
    const bundle = parseOverlay({ kind: 'yaml', content: yamlContent });
    expect(bundle.bundleId).toBe('acme:prod');
  });

  it('keeps an unquoted ISO timestamp the string it was written as', () => {
    const yamlContent = yaml.dump(baseBundle, { schema: yaml.CORE_SCHEMA });

    const bundle = parseOverlay({ kind: 'yaml', content: yamlContent });

    expect(yamlContent).toMatch(/^generatedAt: 2026-05-01T12:00:00\.000Z$/m);
    expect(bundle.generatedAt).toBe('2026-05-01T12:00:00.000Z');
  });

  it('verifies a signed bundle written as YAML with an unquoted generatedAt', () => {
    const keys = generateRsaKeyPair();
    const signature = rsaSignBase64Url(
      'RS256',
      new TextEncoder().encode(canonicalize(baseBundle)),
      keys.privateKey.export({ format: 'jwk' }),
    );
    const signed = {
      ...baseBundle,
      integrity: { alg: 'RS256', keyId: 'ci', digest: bundleDigest(baseBundle as ResolvedBundle), signature },
    };
    const trustedKey = {
      keyId: 'ci',
      alg: 'RS256' as const,
      publicKeyPem: String(keys.publicKey.export({ type: 'spki', format: 'pem' })),
    };

    const bundle = parseOverlay({ kind: 'yaml', content: yaml.dump(signed, { schema: yaml.CORE_SCHEMA }) });

    expect(verifyBundleSignature(bundle, [trustedKey])).toMatchObject({ ok: true, keyId: 'ci' });
  });

  it('reads YAML with the core schema, so a merge key (<<) stays a key, which the bundle schema refuses', () => {
    const yamlContent = yaml
      .dump(baseBundle)
      .replace(
        'authBindings:\n  default:\n    kind: bearer\n    vaultRef: stripe-key\n',
        'authBindings:\n  none: &none\n    kind: none\n  default:\n    <<: *none\n',
      );

    const mergedByDefaultSchema = parseOverlay({ kind: 'object', content: yaml.load(yamlContent) });

    expect(mergedByDefaultSchema.authBindings['default']).toEqual({ kind: 'none' });
    expect(() => parseOverlay({ kind: 'yaml', content: yamlContent })).toThrow('Bundle schema validation failed');
  });

  it('parses JSON input', () => {
    const bundle = parseOverlay({ kind: 'json', content: JSON.stringify(baseBundle) });
    expect(bundle.bundleId).toBe('acme:prod');
  });

  it('throws OverlayParseError on invalid YAML', () => {
    expect(() => parseOverlay({ kind: 'yaml', content: '!! malformed [yaml::' })).toThrow(OverlayParseError);
  });

  it('throws OverlayParseError on invalid JSON', () => {
    expect(() => parseOverlay({ kind: 'json', content: '{not json' })).toThrow(OverlayParseError);
  });

  it('throws when no bundle is found', () => {
    expect(() => parseOverlay({ kind: 'object', content: { foo: 'bar' } })).toThrow(OverlayParseError);
  });

  it('throws when root is null', () => {
    expect(() => parseOverlay({ kind: 'object', content: null })).toThrow(OverlayParseError);
  });

  it('reports schema validation errors with paths', () => {
    const bad = { ...baseBundle, schemaVersion: 99 };
    try {
      parseOverlay({ kind: 'object', content: bad });
      fail('expected OverlayParseError');
    } catch (e) {
      expect(e).toBeInstanceOf(OverlayParseError);
      expect((e as OverlayParseError).errors?.length).toBeGreaterThan(0);
    }
  });

  it('reports cross-validation errors', () => {
    const bad = JSON.parse(JSON.stringify(baseBundle));
    bad.skills[0].operationIds = ['createInvoice', 'doesNotExist'];
    try {
      parseOverlay({ kind: 'object', content: bad });
      fail('expected OverlayParseError');
    } catch (e) {
      expect(e).toBeInstanceOf(OverlayParseError);
      expect((e as OverlayParseError).errors?.some((m) => m.includes('doesNotExist'))).toBe(true);
    }
  });
});
