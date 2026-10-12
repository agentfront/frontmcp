import { type ScopeEntry } from '../../common';
import { mcpEndpointPath, resolveRegistryAuthRecord, serverCardPath } from '../mcp-registry.utils';

const ED25519_PUBLIC_KEY = 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=';

function scopeWith(registry: Record<string, unknown> | undefined) {
  const warn = jest.fn();
  const scope = { metadata: { registry }, logger: { warn } } as unknown as Pick<ScopeEntry, 'metadata' | 'logger'>;
  return { scope, warn };
}

describe('resolveRegistryAuthRecord', () => {
  afterEach(() => {
    delete process.env['REGISTRY_UTILS_SPEC_KEY'];
  });

  it('serves nothing without the registry option', () => {
    process.env['REGISTRY_UTILS_SPEC_KEY'] = ED25519_PUBLIC_KEY;
    expect(resolveRegistryAuthRecord(scopeWith(undefined).scope)).toBeUndefined();
  });

  it('prefers the decorator key over the environment', () => {
    process.env['REGISTRY_UTILS_SPEC_KEY'] = 'CQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQk=';
    const { scope } = scopeWith({ publicKey: ED25519_PUBLIC_KEY, publicKeyEnv: 'REGISTRY_UTILS_SPEC_KEY' });
    expect(resolveRegistryAuthRecord(scope)).toBe(`v=MCPv1; k=ed25519; p=${ED25519_PUBLIC_KEY}`);
  });

  it('logs an invalid environment value once, without the value', () => {
    process.env['REGISTRY_UTILS_SPEC_KEY'] = 'a-private-key-pasted-by-mistake';
    const { scope, warn } = scopeWith({ publicKeyEnv: 'REGISTRY_UTILS_SPEC_KEY' });

    expect(resolveRegistryAuthRecord(scope)).toBeUndefined();
    expect(resolveRegistryAuthRecord(scope)).toBeUndefined();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('REGISTRY_UTILS_SPEC_KEY');
    expect(warn.mock.calls[0][0]).not.toContain('a-private-key-pasted-by-mistake');
  });

  it('logs nothing when the environment holds no key', () => {
    const { scope, warn } = scopeWith({ publicKeyEnv: 'REGISTRY_UTILS_SPEC_KEY' });
    expect(resolveRegistryAuthRecord(scope)).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('server card paths', () => {
  it.each([
    ['', '', '', '/server-card'],
    ['/mcp', '', '/mcp', '/mcp/server-card'],
    ['mcp/', '/billing', '/mcp/billing', '/mcp/billing/server-card'],
  ])('entryPath %p and routeBase %p serve the endpoint at %p', (entryPath, routeBase, endpoint, card) => {
    expect(mcpEndpointPath({ entryPath, routeBase })).toBe(endpoint);
    expect(serverCardPath({ entryPath, routeBase })).toBe(card);
  });
});
