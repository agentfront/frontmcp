/**
 * E2E: the plugin's opt-in `gateDefaultValue` (#719).
 *
 * The `gate-defaults` app installs its own FeatureFlagPlugin with `gateDefaultValue: true`:
 * - `gate-default-open` is gated by a flag the adapter does not know, so the gate default opens it
 * - `gate-default-ref-closed` is gated by the same flag with a ref `defaultValue: false`, which wins
 * - `gate-default-known-off` is gated by a flag the adapter answers `false` for, which stays off
 * - `gate-default-accessor` reads the unknown flag through `this.featureFlags`, which ignores the gate default
 */
import { expect, test } from '@frontmcp/testing';

test.describe('Feature flag gate default E2E (#719)', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-feature-flags/src/main.ts',
    project: 'demo-e2e-feature-flags',
    publicMode: true,
  });

  test('lists and runs a tool whose unknown flag the gate default opens', async ({ mcp }) => {
    const tools = await mcp.tools.list();
    expect(tools).toContainTool('gate-default-open');

    const result = await mcp.tools.call('gate-default-open', {});
    expect(result).toBeSuccessful();
    expect(result).toHaveTextContent('"ran":"gate-default-open"');
  });

  test("lets a ref's defaultValue win over the gate default", async ({ mcp }) => {
    const tools = await mcp.tools.list();
    expect(tools.map((tool) => tool.name)).not.toContain('gate-default-ref-closed');

    const result = await mcp.tools.call('gate-default-ref-closed', {});
    expect(result).toBeError();
    expect(result).toHaveTextContent('disabled by feature flag');
  });

  test('keeps a flag the adapter answers false for disabled', async ({ mcp }) => {
    const result = await mcp.tools.call('gate-default-known-off', {});
    expect(result).toBeError();
    expect(result).toHaveTextContent('disabled by feature flag');
  });

  test('leaves this.featureFlags.isEnabled() on its own fallback', async ({ mcp }) => {
    const result = await mcp.tools.call('gate-default-accessor', {});
    expect(result).toBeSuccessful();
    expect(result).toHaveTextContent('"enabled":false');
  });
});
