/**
 * E2E Tests: Resource Provider Resolution & Plugin Context Extensions
 *
 * Verifies that:
 * 1. App-level providers registered via @App({ providers: [...] }) are accessible
 *    from resources via this.get(Token), sharing the same GLOBAL singleton as tools.
 * 2. Plugin providers exposed via contextExtensions (e.g., this.counter) work
 *    correctly in resource contexts, not just tool contexts.
 */
import { test, expect } from '@frontmcp/testing';

/**
 * Extract JSON content from a resource read result.
 * Resources return { contents: [{ text: '...' }] } so we parse the text.
 */
function extractResourceJson<T>(result: unknown): T {
  const raw = result as { raw?: { contents?: Array<{ text?: string }> } };
  const text = raw?.raw?.contents?.[0]?.text;
  if (!text) throw new Error('No text content in resource result');
  return JSON.parse(text) as T;
}

/**
 * Extract structured content from a tool call result.
 */
function extractToolJson<T>(result: unknown): T {
  const raw = result as { raw?: { structuredContent?: T; content?: Array<{ text?: string }> } };
  if (raw?.raw?.structuredContent) return raw.raw.structuredContent;
  const text = raw?.raw?.content?.[0]?.text;
  if (!text) throw new Error('No content in tool result');
  return JSON.parse(text) as T;
}

test.describe('Resource Provider Resolution E2E', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-resource-providers/src/main.ts',
    project: 'demo-e2e-resource-providers',
    publicMode: true,
  });

  // ─── Discovery ──────────────────────────────────────────────────────────

  test.describe('Discovery', () => {
    test('should list all tools', async ({ mcp }) => {
      const tools = await mcp.tools.list();
      expect(tools).toContainTool('store_set');
      expect(tools).toContainTool('store_get');
      expect(tools).toContainTool('counter_increment');
    });

    test('should list all resources', async ({ mcp }) => {
      const resources = await mcp.resources.list();
      expect(resources).toContainResource('store://contents');
      expect(resources).toContainResource('counter://status');
    });
  });

  // ─── App-level provider in resource via this.get() ─────────────────────

  test.describe('App Provider in Resource', () => {
    test('tool can resolve app provider via this.get()', async ({ mcp }) => {
      const result = await mcp.tools.call('store_set', { key: 'test', value: 'hello' });
      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('storeInstanceId');
    });

    test('resource can resolve same app provider via this.get()', async ({ mcp }) => {
      const resource = await mcp.resources.read('store://contents');
      expect(resource).toBeSuccessful();
      expect(resource).toHaveTextContent('storeInstanceId');
    });

    test('resource and tool share the same GLOBAL provider instance', async ({ mcp }) => {
      // Store a value via tool
      const setResult = await mcp.tools.call('store_set', { key: 'shared-test', value: 'from-tool' });
      expect(setResult).toBeSuccessful();

      // Read back via resource — should see the same data (same singleton)
      const resource = await mcp.resources.read('store://contents');
      expect(resource).toBeSuccessful();
      expect(resource).toHaveTextContent('shared-test');
      expect(resource).toHaveTextContent('from-tool');

      // Compare storeInstanceId
      const toolData = extractToolJson<{ storeInstanceId: string }>(setResult);
      const resourceData = extractResourceJson<{ storeInstanceId: string }>(resource);

      expect(toolData.storeInstanceId).toBeDefined();
      expect(resourceData.storeInstanceId).toBeDefined();
      expect(toolData.storeInstanceId).toBe(resourceData.storeInstanceId);
    });

    test('resource sees data written by tool (shared state)', async ({ mcp }) => {
      await mcp.tools.call('store_set', { key: 'cross-check', value: 'works' });
      const resource = await mcp.resources.read('store://contents');
      expect(resource).toBeSuccessful();
      expect(resource).toHaveTextContent('cross-check');

      const getResult = await mcp.tools.call('store_get', { key: 'cross-check' });
      expect(getResult).toBeSuccessful();
      expect(getResult).toHaveTextContent('works');
    });
  });

  // ─── Plugin context extension in resource ──────────────────────────────

  test.describe('Plugin Context Extension in Resource', () => {
    test('tool can access plugin context extension (this.counter)', async ({ mcp }) => {
      const result = await mcp.tools.call('counter_increment', {});
      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('counterInstanceId');
    });

    test('resource can access plugin context extension (this.counter)', async ({ mcp }) => {
      const resource = await mcp.resources.read('counter://status');
      expect(resource).toBeSuccessful();
      expect(resource).toHaveTextContent('counterInstanceId');
    });

    test('resource and tool share same plugin provider instance', async ({ mcp }) => {
      // Increment via tool
      const inc1 = await mcp.tools.call('counter_increment', {});
      expect(inc1).toBeSuccessful();
      const inc2 = await mcp.tools.call('counter_increment', {});
      expect(inc2).toBeSuccessful();

      // Read counter status via resource
      const resource = await mcp.resources.read('counter://status');
      expect(resource).toBeSuccessful();

      // Counter was incremented twice, so count should be >= 2
      const resourceData = extractResourceJson<{ count: number; counterInstanceId: string }>(resource);
      expect(resourceData.count).toBeGreaterThanOrEqual(2);

      // Verify same plugin instance
      const toolData = extractToolJson<{ counterInstanceId: string }>(inc1);
      expect(toolData.counterInstanceId).toBe(resourceData.counterInstanceId);
    });
  });

  // ─── Cross-component consistency ───────────────────────────────────────

  test.describe('Cross-Component Provider Consistency', () => {
    test('multiple resource reads use same provider instance', async ({ mcp }) => {
      const res1 = await mcp.resources.read('store://contents');
      const res2 = await mcp.resources.read('store://contents');

      expect(res1).toBeSuccessful();
      expect(res2).toBeSuccessful();

      const data1 = extractResourceJson<{ storeInstanceId: string }>(res1);
      const data2 = extractResourceJson<{ storeInstanceId: string }>(res2);
      expect(data1.storeInstanceId).toBe(data2.storeInstanceId);
    });

    test('debug tool and resource both get FlowContextProviders with same instance', async ({ mcp }) => {
      const toolDebug = await mcp.tools.call('debug_providers', {});
      const resourceDebug = await mcp.resources.read('debug://providers');

      expect(toolDebug).toBeSuccessful();
      expect(resourceDebug).toBeSuccessful();

      const toolData = extractToolJson<{ providersType: string; storeInstanceId: string }>(toolDebug);
      const resourceData = extractResourceJson<{ providersType: string; storeInstanceId: string }>(resourceDebug);

      expect(toolData.providersType).toBe('FlowContextProviders');
      expect(resourceData.providersType).toBe('FlowContextProviders');
      expect(toolData.storeInstanceId).toBe(resourceData.storeInstanceId);
    });
  });
});
