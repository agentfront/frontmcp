/**
 * A tool that declares `authProviders: ['github']` reads the credential `@FrontMcp({ authProvidersVault })` registers,
 * through `this.authProviders`, acquired once and kept for later requests; on a server that registers none, it gets an
 * error naming the provider.
 */
import { expect, test } from '@frontmcp/testing';

test.describe('a server with authProvidersVault', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-providers/src/auth-providers-vault.main.ts',
    project: 'demo-e2e-providers',
    publicMode: true,
  });

  test("gives the tool the provider's credential through get() and headers()", async ({ mcp }) => {
    const result = await mcp.tools.call('read-github-credential', {});

    expect(result).toBeSuccessful();
    expect(result.json()).toEqual({ token: 'github-e2e-token-1', authorization: 'Bearer github-e2e-token-1' });
  });

  test("keeps the credential for another client's requests, without running the factory again", async ({ server }) => {
    const first = await server.createClient();
    const second = await server.createClient();

    const firstResult = await first.tools.call('read-github-credential', {});
    const secondResult = await second.tools.call('read-github-credential', {});

    expect([firstResult.json(), secondResult.json()]).toEqual([
      { token: 'github-e2e-token-1', authorization: 'Bearer github-e2e-token-1' },
      { token: 'github-e2e-token-1', authorization: 'Bearer github-e2e-token-1' },
    ]);
  });
});

test.describe('a server without authProvidersVault', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-providers/src/main.ts',
    project: 'demo-e2e-providers',
    publicMode: true,
  });

  test('answers the tool with an error naming the provider it read', async ({ mcp }) => {
    const result = await mcp.tools.call('read-github-credential', {});

    expect(result).toBeError();
    expect(result).toHaveTextContent('Auth provider "github" is not configured');
  });
});
