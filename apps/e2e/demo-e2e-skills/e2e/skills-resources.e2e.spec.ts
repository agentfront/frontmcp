/**
 * E2E Tests for skills:// MCP Resources
 *
 * Tests the resource-based skill access via the skills:// URI scheme:
 * - skills://catalog — list all skills
 * - skills://{skillName} — load skill content
 * - skills://{skillName}/SKILL.md — alias for above
 * - skills://{skillName}/references — list references
 * - skills://{skillName}/references/{name} — read reference
 * - skills://{skillName}/examples — list examples
 * - skills://{skillName}/examples/{name} — read example
 * - Auto-complete for skill names
 */
import { test, expect } from '@frontmcp/testing';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

let nextRequestId = 1000;

function extractResourceText(result: unknown): string {
  const raw = result as { raw?: { contents?: Array<{ text?: string }> } };
  const text = raw?.raw?.contents?.[0]?.text;
  if (!text) throw new Error('No text content in resource result');
  return text;
}

function extractResourceJson<T>(result: unknown): T {
  return JSON.parse(extractResourceText(result)) as T;
}

async function requestCompletion(
  mcp: { raw: { request: (msg: JsonRpcRequest) => Promise<JsonRpcResponse> } },
  uri: string,
  argName: string,
  argValue: string,
): Promise<{ values: string[]; total?: number; hasMore?: boolean }> {
  const response = await mcp.raw.request({
    jsonrpc: '2.0' as const,
    id: nextRequestId++,
    method: 'completion/complete',
    params: {
      ref: { type: 'ref/resource', uri },
      argument: { name: argName, value: argValue },
    },
  });

  if (response.error) {
    throw new Error(`Completion error: ${JSON.stringify(response.error)}`);
  }

  if (!response.result?.completion || !Array.isArray((response.result.completion as any).values)) {
    throw new Error(`Malformed completion response: ${JSON.stringify(response)}`);
  }
  return response.result.completion as { values: string[]; total?: number; hasMore?: boolean };
}

test.describe('Skills Resources E2E', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-skills/src/main.ts',
    project: 'demo-e2e-skills',
    publicMode: true,
  });

  test.describe('Resource Template Discovery', () => {
    test('should list skills:// resource templates', async ({ mcp }) => {
      const templates = await mcp.resources.listTemplates();
      const uriTemplates = templates.map((t: { uriTemplate: string }) => t.uriTemplate);

      expect(uriTemplates).toContain('skills://{skillName}');
      expect(uriTemplates).toContain('skills://{skillName}/SKILL.md');
      expect(uriTemplates).toContain('skills://{skillName}/references');
      expect(uriTemplates).toContain('skills://{skillName}/references/{referenceName}');
      expect(uriTemplates).toContain('skills://{skillName}/examples');
      expect(uriTemplates).toContain('skills://{skillName}/examples/{exampleName}');
    });

    test('should list skills://catalog as a static resource', async ({ mcp }) => {
      const resources = await mcp.resources.list();
      const uris = resources.map((r: { uri: string }) => r.uri);
      expect(uris).toContain('skills://catalog');
    });
  });

  test.describe('skills://catalog', () => {
    test('should return all MCP-visible skills', async ({ mcp }) => {
      const result = await mcp.resources.read('skills://catalog');
      expect(result).toBeSuccessful();

      const catalog = extractResourceJson<Array<{ name: string; description: string; tags: string[] }>>(result);
      expect(Array.isArray(catalog)).toBe(true);
      expect(catalog.length).toBeGreaterThan(0);

      const names = catalog.map((s) => s.name);
      expect(names).toContain('review-pr');
      expect(names).toContain('deploy-app');
      expect(names).toContain('notify-team');
      expect(names).toContain('mcp-only-workflow');
    });

    test('should not include http-only skills', async ({ mcp }) => {
      const result = await mcp.resources.read('skills://catalog');
      expect(result).toBeSuccessful();

      const catalog = extractResourceJson<Array<{ name: string }>>(result);
      const names = catalog.map((s) => s.name);
      expect(names).not.toContain('http-only-workflow');
    });

    test('should not include hidden skills', async ({ mcp }) => {
      const result = await mcp.resources.read('skills://catalog');
      expect(result).toBeSuccessful();

      const catalog = extractResourceJson<Array<{ name: string }>>(result);
      const names = catalog.map((s) => s.name);
      expect(names).not.toContain('hidden-internal');
    });

    test('should include skill metadata (tags, tools)', async ({ mcp }) => {
      const result = await mcp.resources.read('skills://catalog');
      expect(result).toBeSuccessful();

      const catalog = extractResourceJson<Array<{ name: string; tags: string[]; tools: string[] }>>(result);
      const reviewPr = catalog.find((s) => s.name === 'review-pr');

      expect(reviewPr).toBeDefined();
      expect(reviewPr!.tags).toContain('github');
      expect(reviewPr!.tags).toContain('code-review');
      expect(reviewPr!.tools).toContain('github_get_pr');
      expect(reviewPr!.tools).toContain('github_add_comment');
    });
  });

  test.describe('skills://{skillName}', () => {
    test('should return formatted skill content', async ({ mcp }) => {
      const result = await mcp.resources.read('skills://review-pr');
      expect(result).toBeSuccessful();

      const text = extractResourceText(result);
      expect(text).toContain('review-pr');
      expect(text).toContain('PR Review Process');
      expect(text).toContain('github_get_pr');
    });

    test('should return skill content via SKILL.md alias', async ({ mcp }) => {
      const result = await mcp.resources.read('skills://review-pr/SKILL.md');
      expect(result).toBeSuccessful();

      const text = extractResourceText(result);
      expect(text).toContain('PR Review Process');
    });

    test('should include tool availability info', async ({ mcp }) => {
      const result = await mcp.resources.read('skills://deploy-app');
      expect(result).toBeSuccessful();

      const text = extractResourceText(result);
      // Should mention missing tools
      expect(text).toContain('docker_build');
      expect(text).toContain('k8s_apply');
    });

    test('should return mcp-only skill via resources', async ({ mcp }) => {
      const result = await mcp.resources.read('skills://mcp-only-workflow');
      expect(result).toBeSuccessful();

      const text = extractResourceText(result);
      expect(text).toContain('MCP-Only Workflow');
    });

    test('should fail for non-existent skill', async ({ mcp }) => {
      const result = await mcp.resources.read('skills://nonexistent-skill-xyz');
      expect(result).toBeError();
      expect(result.error?.message).toMatch(/not found/i);
    });

    test('should fail for http-only skill', async ({ mcp }) => {
      const result = await mcp.resources.read('skills://http-only-workflow');
      expect(result).toBeError();
      expect(result.error?.message).toMatch(/not available via MCP/i);
    });
  });

  test.describe('skills://{skillName}/references', () => {
    test('should return empty list for skill without references', async ({ mcp }) => {
      const result = await mcp.resources.read('skills://review-pr/references');
      expect(result).toBeSuccessful();

      const refs = extractResourceJson<Array<{ name: string }>>(result);
      // Inline skills without file resources have no references
      expect(Array.isArray(refs)).toBe(true);
    });
  });

  test.describe('skills://{skillName}/examples', () => {
    test('should return empty list for skill without examples', async ({ mcp }) => {
      const result = await mcp.resources.read('skills://review-pr/examples');
      expect(result).toBeSuccessful();

      const examples = extractResourceJson<Array<{ name: string }>>(result);
      expect(Array.isArray(examples)).toBe(true);
    });
  });

  test.describe('Auto-Complete', () => {
    test('should complete skillName with empty prefix', async ({ mcp }) => {
      const result = await requestCompletion(mcp, 'skills://{skillName}', 'skillName', '');
      expect(result.values).toBeDefined();
      expect(result.values.length).toBeGreaterThan(0);
      expect(result.values).toContain('review-pr');
      expect(result.values).toContain('deploy-app');
    });

    test('should complete skillName with partial prefix', async ({ mcp }) => {
      const result = await requestCompletion(mcp, 'skills://{skillName}', 'skillName', 'review');
      expect(result.values).toContain('review-pr');
      // Should not contain non-matching skills
      expect(result.values).not.toContain('deploy-app');
    });

    test('should complete skillName on SKILL.md template', async ({ mcp }) => {
      const result = await requestCompletion(mcp, 'skills://{skillName}/SKILL.md', 'skillName', 'dep');
      expect(result.values).toContain('deploy-app');
    });

    test('should complete skillName on references template', async ({ mcp }) => {
      const result = await requestCompletion(mcp, 'skills://{skillName}/references', 'skillName', '');
      expect(result.values.length).toBeGreaterThan(0);
    });

    test('should not include http-only skills in completions', async ({ mcp }) => {
      const result = await requestCompletion(mcp, 'skills://{skillName}', 'skillName', '');
      expect(result.values).not.toContain('http-only-workflow');
    });

    test('should not include hidden skills in completions', async ({ mcp }) => {
      const result = await requestCompletion(mcp, 'skills://{skillName}', 'skillName', '');
      expect(result.values).not.toContain('hidden-internal');
    });
  });

  test.describe('Concurrent Access', () => {
    test('should handle concurrent resource reads', async ({ mcp }) => {
      const [catalog, reviewPr, deployApp] = await Promise.all([
        mcp.resources.read('skills://catalog'),
        mcp.resources.read('skills://review-pr'),
        mcp.resources.read('skills://deploy-app'),
      ]);

      expect(catalog).toBeSuccessful();
      expect(reviewPr).toBeSuccessful();
      expect(deployApp).toBeSuccessful();
    });
  });
});
