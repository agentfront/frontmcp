import * as yaml from 'js-yaml';

import { OverlayParseError, parseOverlay } from '../bundle/overlay-parser';

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
