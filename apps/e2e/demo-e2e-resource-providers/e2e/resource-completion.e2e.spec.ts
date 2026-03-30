/**
 * E2E Tests: Resource Argument Completion
 *
 * Verifies the complete flow of MCP completion/complete requests for resource templates:
 * 1. Convention-based completers (${argName}Completer) work end-to-end with DI
 * 2. Override-based completers (getArgumentCompleter) work end-to-end with DI
 * 3. Multiple parameters can each have their own completer
 * 4. Empty/partial matching returns correct filtered results
 * 5. Resources without completers return empty completions
 * 6. Unknown resources return empty completions
 * 7. The completion response matches MCP protocol shape
 */
import { test, expect } from '@frontmcp/testing';

/**
 * Send a completion/complete request and extract the completion result.
 */
async function requestCompletion(
  mcp: { raw: { request: (msg: any) => Promise<any> } },
  uri: string,
  argName: string,
  argValue: string,
): Promise<{ values: string[]; total?: number; hasMore?: boolean }> {
  const response = await mcp.raw.request({
    jsonrpc: '2.0' as const,
    id: Date.now(),
    method: 'completion/complete',
    params: {
      ref: { type: 'ref/resource', uri },
      argument: { name: argName, value: argValue },
    },
  });

  if (response.error) {
    throw new Error(`Completion error: ${JSON.stringify(response.error)}`);
  }

  return response.result?.completion ?? { values: [] };
}

test.describe('Resource Argument Completion E2E', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-resource-providers/src/main.ts',
    project: 'demo-e2e-resource-providers',
    publicMode: true,
  });

  // ─── Discovery ───────────────────────────────────────────────────────

  test.describe('Discovery', () => {
    test('should list resource templates including completion-enabled ones', async ({ mcp }) => {
      const templates = await mcp.resources.listTemplates();
      const names = templates.map((t: { name: string }) => t.name);

      expect(names).toContain('category-products');
      expect(names).toContain('product-detail');
      expect(names).toContain('plain-template');
    });
  });

  // ─── Convention-based Completer ──────────────────────────────────────

  test.describe('Convention-based completer (categoryNameCompleter)', () => {
    test('should return all categories for empty partial', async ({ mcp }) => {
      const result = await requestCompletion(mcp, 'catalog://{categoryName}/products', 'categoryName', '');

      expect(result.values).toEqual(expect.arrayContaining(['electronics', 'books', 'clothing', 'food', 'furniture']));
      expect(result.values.length).toBe(5);
      expect(result.total).toBe(5);
    });

    test('should filter categories by partial match', async ({ mcp }) => {
      const result = await requestCompletion(mcp, 'catalog://{categoryName}/products', 'categoryName', 'foo');

      expect(result.values).toEqual(['food']);
      expect(result.total).toBe(1);
    });

    test('should filter categories case-insensitively', async ({ mcp }) => {
      const result = await requestCompletion(mcp, 'catalog://{categoryName}/products', 'categoryName', 'ELEC');

      expect(result.values).toEqual(['electronics']);
    });

    test('should return empty for non-matching partial', async ({ mcp }) => {
      const result = await requestCompletion(mcp, 'catalog://{categoryName}/products', 'categoryName', 'xyz-no-match');

      expect(result.values).toEqual([]);
      expect(result.total).toBe(0);
    });

    test('should use DI to access CatalogService (not crash)', async ({ mcp }) => {
      // This test validates that the convention completer has proper DI access.
      // If DI were broken (the original bug), this would throw:
      // "TypeError: Cannot read properties of undefined (reading 'get')"
      const result = await requestCompletion(mcp, 'catalog://{categoryName}/products', 'categoryName', 'b');

      expect(result.values).toEqual(['books']);
    });
  });

  // ─── Override-based Completer ────────────────────────────────────────

  test.describe('Override-based completer (getArgumentCompleter)', () => {
    test('should complete categoryName parameter', async ({ mcp }) => {
      const result = await requestCompletion(
        mcp,
        'catalog://{categoryName}/products/{productName}',
        'categoryName',
        'cl',
      );

      expect(result.values).toEqual(['clothing']);
    });

    test('should complete productName parameter', async ({ mcp }) => {
      const result = await requestCompletion(
        mcp,
        'catalog://{categoryName}/products/{productName}',
        'productName',
        'lap',
      );

      expect(result.values).toContain('laptop');
    });

    test('should return all products for empty productName partial', async ({ mcp }) => {
      const result = await requestCompletion(mcp, 'catalog://{categoryName}/products/{productName}', 'productName', '');

      // All unique products across all categories
      expect(result.values.length).toBeGreaterThan(10);
      expect(result.hasMore).toBe(false);
    });

    test('should return multiple matching products', async ({ mcp }) => {
      // "sh" matches: shirt, shoes, bookshelf
      const result = await requestCompletion(
        mcp,
        'catalog://{categoryName}/products/{productName}',
        'productName',
        'sh',
      );

      expect(result.values).toEqual(expect.arrayContaining(['shirt', 'shoes']));
      expect(result.values.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ─── No Completer ───────────────────────────────────────────────────

  test.describe('Resource without completer', () => {
    test('should return empty values for template with no completer', async ({ mcp }) => {
      const result = await requestCompletion(mcp, 'plain://{itemId}/info', 'itemId', 'test');

      expect(result.values).toEqual([]);
    });
  });

  // ─── Unknown / Invalid Resources ─────────────────────────────────────

  test.describe('Unknown and invalid resources', () => {
    test('should return empty values for non-existent resource URI', async ({ mcp }) => {
      const result = await requestCompletion(mcp, 'unknown://{id}/data', 'id', 'test');

      expect(result.values).toEqual([]);
    });

    test('should return empty values for unknown argument name', async ({ mcp }) => {
      const result = await requestCompletion(mcp, 'catalog://{categoryName}/products', 'nonExistentArg', 'test');

      expect(result.values).toEqual([]);
    });
  });

  // ─── Protocol Compliance ─────────────────────────────────────────────

  test.describe('MCP Protocol Compliance', () => {
    test('should return proper completion response shape', async ({ mcp }) => {
      const response = await mcp.raw.request({
        jsonrpc: '2.0' as const,
        id: 42,
        method: 'completion/complete',
        params: {
          ref: { type: 'ref/resource', uri: 'catalog://{categoryName}/products' },
          argument: { name: 'categoryName', value: 'e' },
        },
      });

      expect(response.error).toBeUndefined();
      expect(response.result).toBeDefined();
      expect(response.result.completion).toBeDefined();
      expect(Array.isArray(response.result.completion.values)).toBe(true);
      expect(response.result.completion.values).toContain('electronics');
    });

    test('should support repeated completion requests (stateless)', async ({ mcp }) => {
      const r1 = await requestCompletion(mcp, 'catalog://{categoryName}/products', 'categoryName', 'e');
      const r2 = await requestCompletion(mcp, 'catalog://{categoryName}/products', 'categoryName', 'e');

      expect(r1.values).toEqual(r2.values);
    });

    test('should handle concurrent completion requests', async ({ mcp }) => {
      const [r1, r2, r3] = await Promise.all([
        requestCompletion(mcp, 'catalog://{categoryName}/products', 'categoryName', 'e'),
        requestCompletion(mcp, 'catalog://{categoryName}/products', 'categoryName', 'b'),
        requestCompletion(mcp, 'catalog://{categoryName}/products/{productName}', 'productName', 'lap'),
      ]);

      expect(r1.values).toContain('electronics');
      expect(r2.values).toContain('books');
      expect(r3.values).toContain('laptop');
    });
  });

  // ─── Resource Read Still Works ───────────────────────────────────────

  test.describe('Resource read is not affected by completion', () => {
    test('should read category-products resource after completions', async ({ mcp }) => {
      // Do a completion first
      await requestCompletion(mcp, 'catalog://{categoryName}/products', 'categoryName', 'e');

      // Then read the resource — should work independently
      const resource = await mcp.resources.read('catalog://electronics/products');
      expect(resource).toBeSuccessful();
      expect(resource).toHaveTextContent('electronics');
      expect(resource).toHaveTextContent('laptop');
    });
  });
});
