/**
 * `@frontmcp/testing`'s `McpTestClient` speaking 2026-07-28 to a real server, through `test.use({ protocolVersion })`.
 */
import { expect, test } from '@frontmcp/testing';

test.describe('protocol 2026-07-28 — McpTestClient', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-protocol-20260728/src/main.ts',
    project: 'demo-e2e-protocol-20260728',
    publicMode: true,
    protocolVersion: '2026-07-28',
  });

  test('connects with server/discover', async ({ mcp }) => {
    const discovered = await mcp.discover();

    expect(mcp.protocolVersion).toBe('2026-07-28');
    expect(mcp.serverInfo.name).toBe('Demo E2E Protocol 2026');
    expect(mcp.sessionId).toBe('');
    expect(discovered.supportedVersions).toContain('2026-07-28');
  });

  test('lists and calls tools, mirroring x-mcp-header arguments', async ({ mcp }) => {
    expect(await mcp.tools.list()).toContainTool('region-query');

    const result = await mcp.tools.call('region-query', { region: 'us-west1', query: 'SELECT 1' });

    expect(result).toBeSuccessful();
    expect(result.json()).toEqual({ region: 'us-west1', query: 'SELECT 1' });
    expect(mcp.transport_info.lastRequestHeaders).toMatchObject({ 'Mcp-Param-Region': 'us-west1' });
  });

  test('reads resources and gets prompts', async ({ mcp }) => {
    expect(await mcp.resources.list()).toContainResource('proto://config');
    expect((await mcp.resources.read('proto://config')).json()).toEqual({
      env: 'e2e',
      featureFlags: ['protocol-2026'],
    });
    expect((await mcp.prompts.get('greeting', { subject: 'ada' })).messages[0].content).toEqual({
      type: 'text',
      text: 'Say hello to ada.',
    });
  });

  test('answers an elicitation through the input_required round trip', async ({ mcp }) => {
    mcp.onElicitation(() => ({ action: 'accept', content: { confirmed: true } }));

    const result = await mcp.tools.call('confirm', { action: 'ship it' });

    expect(result.json()).toEqual({ action: 'ship it', confirmed: true });
  });

  test("has the call's progress when tools.call() returns", async ({ mcp }) => {
    const progress = mcp.notifications.collectProgress();

    await mcp.tools.call('chatty', { steps: 2 });

    expect(progress.all.map(({ progress: value }) => value)).toEqual([1, 2]);
  });

  test('fails with the JSON-RPC error of a method 2026-07-28 removed', async ({ mcp }) => {
    const response = await mcp.raw.request({ jsonrpc: '2.0', id: 'ping-1', method: 'ping' });

    expect(response.error?.code).toBe(-32601);
  });

  test('subscribes to a resource with subscriptions/listen', async ({ mcp }) => {
    await expect(mcp.resources.subscribe('proto://config')).resolves.toBeUndefined();
  });
});
