/**
 * parseFrontMcpConfigLite — round-trip tests for fields that the CLI/MCPB
 * builds need preserved without forcing the full base-schema validation.
 *
 * Regression: #366 — `authorities` was stripped by the lite schema, which
 * caused `Scope.validateAuthoritiesConfig` to throw `AuthConfigurationError`
 * for any tool that declared `authorities` metadata, breaking every CLI
 * and MCPB build.
 */

import { parseFrontMcpConfigLite } from '../front-mcp.metadata';

// Remote-app form is the easiest valid `apps` entry to construct in a test —
// no decorator metadata required, only the documented fields below.
const minimalApps = [
  {
    name: 'remote-app',
    urlType: 'url',
    url: 'https://example.com',
  },
] as never;

describe('parseFrontMcpConfigLite — preserves CLI-relevant fields', () => {
  it('preserves authorities through the lite schema', () => {
    const input = {
      info: { name: 'demo', version: '0.1.0' },
      apps: minimalApps,
      authorities: {
        claimsMapping: { roles: 'roles', permissions: 'permissions', userId: 'sub' },
        profiles: { admin: { roles: { any: ['admin'] } } },
      },
    };
    const parsed = parseFrontMcpConfigLite(input as never) as unknown as Record<string, unknown>;
    expect(parsed['authorities']).toEqual(input.authorities);
  });

  it('omits authorities when not provided', () => {
    const input = {
      info: { name: 'demo', version: '0.1.0' },
      apps: minimalApps,
    };
    const parsed = parseFrontMcpConfigLite(input as never) as unknown as Record<string, unknown>;
    expect(parsed['authorities']).toBeUndefined();
  });

  it('does not validate the inner shape (pass-through)', () => {
    const input = {
      info: { name: 'demo', version: '0.1.0' },
      apps: minimalApps,
      // Intentionally weird inner shape — lite parse must NOT reject it.
      authorities: { custom: { engine: 'opa', endpoint: 'http://opa' } },
    };
    expect(() => parseFrontMcpConfigLite(input as never)).not.toThrow();
  });
});
