/**
 * E2E Tests for SEP-2640 `skill://` MCP Resources
 *
 * Tests the resource-based skill access via the singular `skill://` URI scheme:
 * - skill://index.json                — discovery index (agentskills.io schema)
 * - skill://{skillPath}/SKILL.md      — raw SKILL.md (frontmatter + body)
 * - skill://{skillPath}/{filePath}    — any file inside the skill directory
 * - Auto-complete for skill paths
 */
import { expect, test } from '@frontmcp/testing';

import type { JsonRpcRequest, JsonRpcResponse } from './helpers/skills-protocol';

interface CompletionPayload {
  completion?: { values: string[]; total?: number; hasMore?: boolean };
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

  const completionResult = response.result as CompletionPayload | undefined;
  if (!completionResult?.completion || !Array.isArray(completionResult.completion.values)) {
    throw new Error(`Malformed completion response: ${JSON.stringify(response)}`);
  }
  return completionResult.completion;
}

interface SkillIndexEntry {
  type: 'skill-md' | 'mcp-resource-template' | 'archive';
  name?: string;
  description: string;
  url: string;
}
interface SkillIndexDocument {
  $schema: string;
  skills: SkillIndexEntry[];
}

test.describe('SEP-2640 Skills Resources E2E', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-skills/src/main.ts',
    project: 'demo-e2e-skills',
    publicMode: true,
  });

  test.describe('Resource Template Discovery', () => {
    test('should list skill:// resource templates', async ({ mcp }) => {
      const templates = await mcp.resources.listTemplates();
      const uriTemplates = templates.map((t: { uriTemplate: string }) => t.uriTemplate);

      expect(uriTemplates).toContain('skill://{+skillPath}/SKILL.md');
      expect(uriTemplates).toContain('skill://{+skillPath}/{+filePath}');
    });

    test('should list skill://index.json as a static resource', async ({ mcp }) => {
      const resources = await mcp.resources.list();
      const uris = resources.map((r: { uri: string }) => r.uri);
      expect(uris).toContain('skill://index.json');
    });
  });

  test.describe('skill://index.json', () => {
    test('should return the SEP-2640 discovery document', async ({ mcp }) => {
      const result = await mcp.resources.read('skill://index.json');
      expect(result).toBeSuccessful();

      const doc = extractResourceJson<SkillIndexDocument>(result);
      expect(doc.$schema).toBe('https://schemas.agentskills.io/discovery/0.2.0/schema.json');
      expect(Array.isArray(doc.skills)).toBe(true);
      expect(doc.skills.length).toBeGreaterThan(0);

      const names = doc.skills.filter((s) => s.type === 'skill-md').map((s) => s.name);
      expect(names).toContain('review-pr');
      expect(names).toContain('deploy-app');
      expect(names).toContain('notify-team');
      expect(names).toContain('mcp-only-workflow');
    });

    test('should include skill-md type and full URLs', async ({ mcp }) => {
      const result = await mcp.resources.read('skill://index.json');
      const doc = extractResourceJson<SkillIndexDocument>(result);

      const reviewPr = doc.skills.find((s) => s.name === 'review-pr');
      expect(reviewPr).toEqual(
        expect.objectContaining({
          type: 'skill-md',
          url: 'skill://review-pr/SKILL.md',
          description: expect.any(String),
        }),
      );
    });

    test('should not include http-only skills', async ({ mcp }) => {
      const result = await mcp.resources.read('skill://index.json');
      const doc = extractResourceJson<SkillIndexDocument>(result);
      const names = doc.skills.map((s) => s.name);
      expect(names).not.toContain('http-only-workflow');
    });

    test('should not include hidden skills', async ({ mcp }) => {
      const result = await mcp.resources.read('skill://index.json');
      const doc = extractResourceJson<SkillIndexDocument>(result);
      const names = doc.skills.map((s) => s.name);
      expect(names).not.toContain('hidden-internal');
    });
  });

  test.describe('skill://{skillPath}/SKILL.md', () => {
    test('should return raw SKILL.md (frontmatter + body)', async ({ mcp }) => {
      const result = await mcp.resources.read('skill://review-pr/SKILL.md');
      expect(result).toBeSuccessful();

      const text = extractResourceText(result);
      // SEP-2640 mandates raw frontmatter + body, not formatted-for-LLM markdown
      expect(text.startsWith('---\n')).toBe(true);
      expect(text).toContain('name: review-pr');
      expect(text).toContain('description:');
      expect(text).toContain('PR Review Process');
    });

    test('should return raw SKILL.md for nested deploy-app', async ({ mcp }) => {
      const result = await mcp.resources.read('skill://deploy-app/SKILL.md');
      expect(result).toBeSuccessful();

      const text = extractResourceText(result);
      expect(text).toContain('name: deploy-app');
    });

    test('should return mcp-only skill', async ({ mcp }) => {
      const result = await mcp.resources.read('skill://mcp-only-workflow/SKILL.md');
      expect(result).toBeSuccessful();

      const text = extractResourceText(result);
      expect(text).toContain('name: mcp-only-workflow');
    });

    test('should fail for non-existent skill', async ({ mcp }) => {
      const result = await mcp.resources.read('skill://nonexistent-skill-xyz/SKILL.md');
      expect(result).toBeError();
      expect(result.error?.message).toMatch(/not found/i);
    });

    test('should fail for http-only skill', async ({ mcp }) => {
      const result = await mcp.resources.read('skill://http-only-workflow/SKILL.md');
      expect(result).toBeError();
    });
  });

  test.describe('skill://{skillPath}/{filePath} — sub-files', () => {
    test('should read a reference file', async ({ mcp }) => {
      const result = await mcp.resources.read('skill://docs-skill/references/getting-started.md');
      expect(result).toBeSuccessful();

      const text = extractResourceText(result);
      expect(text).toContain('Getting Started');
      expect(text).toContain('Prerequisites');
    });

    test('should read an example file', async ({ mcp }) => {
      const result = await mcp.resources.read('skill://docs-skill/examples/basic-setup.md');
      expect(result).toBeSuccessful();

      const text = extractResourceText(result);
      expect(text).toContain('Basic Setup');
    });

    test('should return error for missing sub-file', async ({ mcp }) => {
      const result = await mcp.resources.read('skill://docs-skill/references/nonexistent.md');
      expect(result).toBeError();
    });

    test('should reject path traversal attempts', async ({ mcp }) => {
      const result = await mcp.resources.read('skill://docs-skill/../../etc/passwd');
      expect(result).toBeError();
    });

    test('should reject percent-encoded traversal attempts', async ({ mcp }) => {
      // Without decode-before-split, `references%2F..%2FSKILL.md` survives
      // the literal `..` and `SKILL.md` guards because it stays a single
      // segment until decoding, then turns into `references/../SKILL.md`.
      const result = await mcp.resources.read('skill://docs-skill/references%2F..%2FSKILL.md');
      expect(result).toBeError();
    });
  });

  test.describe('Auto-Complete', () => {
    test('should complete skillPath with empty prefix', async ({ mcp }) => {
      const result = await requestCompletion(mcp, 'skill://{+skillPath}/SKILL.md', 'skillPath', '');
      expect(result.values).toBeDefined();
      expect(result.values.length).toBeGreaterThan(0);
      expect(result.values).toContain('review-pr');
      expect(result.values).toContain('deploy-app');
    });

    test('should complete skillPath with partial prefix', async ({ mcp }) => {
      const result = await requestCompletion(mcp, 'skill://{+skillPath}/SKILL.md', 'skillPath', 'review');
      expect(result.values).toContain('review-pr');
      expect(result.values).not.toContain('deploy-app');
    });

    test('should not include http-only skills in completions', async ({ mcp }) => {
      const result = await requestCompletion(mcp, 'skill://{+skillPath}/SKILL.md', 'skillPath', '');
      expect(result.values).not.toContain('http-only-workflow');
    });

    test('should not include hidden skills in completions', async ({ mcp }) => {
      const result = await requestCompletion(mcp, 'skill://{+skillPath}/SKILL.md', 'skillPath', '');
      expect(result.values).not.toContain('hidden-internal');
    });
  });

  test.describe('Concurrent Access', () => {
    test('should handle concurrent resource reads', async ({ mcp }) => {
      const [index, reviewPr, deployApp] = await Promise.all([
        mcp.resources.read('skill://index.json'),
        mcp.resources.read('skill://review-pr/SKILL.md'),
        mcp.resources.read('skill://deploy-app/SKILL.md'),
      ]);

      expect(index).toBeSuccessful();
      expect(reviewPr).toBeSuccessful();
      expect(deployApp).toBeSuccessful();
    });
  });
});
