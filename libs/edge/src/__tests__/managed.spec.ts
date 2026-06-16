/**
 * Managed edge mode — verifies the manifest→plugin wiring without a live SaaS
 * pull. The full pull/auto-update path is exercised by the skilled-openapi
 * plugin's own e2e (`demo-e2e-skilled-openapi`); here we verify (1) the pure
 * options mapping and (2) that `createEdgeMcp({ managed })` constructs lazily
 * (no plugin load until the first request).
 */
import 'reflect-metadata';

import { buildManagedOpenApiPluginOptions, createEdgeMcp, type ManagedEdgeOptions } from '../index';

const MANAGED: ManagedEdgeOptions = {
  endpoint: 'https://cloud.frontmcp.dev/v1/bundles/acme',
  authToken: 'pinned-jwt',
  expectedAudience: 'acme-mcp',
  jwksUrl: 'https://cloud.frontmcp.dev/.well-known/jwks.json',
  expectedIssuer: 'https://cloud.frontmcp.dev',
};

describe('buildManagedOpenApiPluginOptions', () => {
  it('maps required managed fields into a saas bundle source', () => {
    const opts = buildManagedOpenApiPluginOptions(MANAGED);
    expect(opts['source']).toEqual({
      type: 'saas',
      endpoint: MANAGED.endpoint,
      authToken: MANAGED.authToken,
      expectedAudience: MANAGED.expectedAudience,
      jwksUrl: MANAGED.jwksUrl,
      expectedIssuer: MANAGED.expectedIssuer,
    });
  });

  it('forwards auto-update + plugin flags when provided', () => {
    const opts = buildManagedOpenApiPluginOptions({
      ...MANAGED,
      pollIntervalMs: 60_000,
      enableWebhook: true,
      requireSignature: false,
      dev: true,
      credentials: { 'acme-token': 'xyz' },
    });
    const source = opts['source'] as Record<string, unknown>;
    expect(source['pollIntervalMs']).toBe(60_000);
    expect(source['enableWebhook']).toBe(true);
    expect(opts['requireSignature']).toBe(false);
    expect(opts['dev']).toBe(true);
    expect(opts['credentials']).toEqual({ 'acme-token': 'xyz' });
  });

  it('omits unset optional fields (no undefined leakage)', () => {
    const opts = buildManagedOpenApiPluginOptions(MANAGED);
    expect('requireSignature' in opts).toBe(false);
    expect('dev' in opts).toBe(false);
    expect('pollIntervalMs' in (opts['source'] as object)).toBe(false);
  });
});

describe('createEdgeMcp({ managed })', () => {
  it('constructs lazily without loading the plugin (no throw at construction)', () => {
    const edge = createEdgeMcp({
      info: { name: 'managed-edge', version: '1.0.0' },
      apps: [],
      tasks: { enabled: false },
      managed: MANAGED,
    } as Parameters<typeof createEdgeMcp>[0]);
    expect(typeof edge.fetch).toBe('function');
  });
});
