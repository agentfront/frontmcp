/**
 * A tool that declares `authProviders: ['github']` reads the credential `@FrontMcp({ authProvidersVault })` registers,
 * through `this.authProviders`; on a server that registers none, it gets an error naming the provider.
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
    expect(result.json()).toEqual({ token: 'github-e2e-token', authorization: 'Bearer github-e2e-token' });
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
