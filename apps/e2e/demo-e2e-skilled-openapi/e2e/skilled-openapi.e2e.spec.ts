/**
 * E2E for @frontmcp/plugin-skilled-openapi
 *
 * Boots a FrontMCP server backed by the plugin (static-source bundle, mock
 * REST upstream on :9876, dev-mode signing bypass) and verifies:
 *   - tools/list exposes ONLY the three meta-tools (no raw OpenAPI ops leak)
 *   - skills/list shows the bundled skills with bundleVersion threaded through
 *   - search_skill returns matches scored against the registry
 *   - load_skill returns instructions + the actions[] schemas
 *   - run_workflow runs an enclave-sandboxed AgentScript whose callTool(actionId,…)
 *     invokes the upstream with the configured bearer credential and a JSON body
 *     (the mock answers 415 to a body sent without `application/json`)
 *   - ABAC denial, unknown actions and input-validation failures come back as
 *     `{ success: false, error }` instead of throwing
 */

import { expect, test } from '@frontmcp/testing';

interface SearchSkillResponse {
  skills: Array<{ skillId: string; name: string; description: string; score: number; bundleVersion?: string }>;
}

interface LoadSkillResponse {
  skill: {
    id: string;
    name: string;
    description: string;
    instructions: string;
    bundleVersion?: string;
    actions?: Array<{
      actionId: string;
      summary: string;
      inputJsonSchema: Record<string, unknown>;
      outputJsonSchema: Record<string, unknown>;
      requiredAuthorities?: Record<string, unknown>;
    }>;
  };
  isComplete: boolean;
  warning?: string;
}

interface RunWorkflowResponse {
  success: boolean;
  value?: unknown;
  error?: string;
}

test.describe('SkilledOpenApi Plugin E2E', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-skilled-openapi/src/main.ts',
    project: 'demo-e2e-skilled-openapi',
    publicMode: true,
  });

  test.describe('tools/list surface', () => {
    test('exposes the three skilled-openapi meta-tools', async ({ mcp }) => {
      const tools = await mcp.tools.list();
      expect(tools).toContainTool('search_skill');
      expect(tools).toContainTool('load_skill');
      expect(tools).toContainTool('run_workflow');
    });

    test('does NOT expose raw OpenAPI operations (operationIds stay hidden)', async ({ mcp }) => {
      const tools = await mcp.tools.list();
      // The MCP tools/list response shape varies — find the array property dynamically.
      const list =
        (tools as unknown as { tools?: Array<{ name: string }> }).tools ??
        (tools as unknown as Array<{ name: string }>);
      const names = (Array.isArray(list) ? list : []).map((t) => t.name);
      expect(names).not.toContain('createInvoice');
      expect(names).not.toContain('getInvoice');
      expect(names).not.toContain('refundInvoice');
      expect(names).not.toContain('adminPing');
    });
  });

  test.describe('search_skill', () => {
    test('finds the invoices skill from a free-form query', async ({ mcp }) => {
      // Use distinctive terms that appear in the invoices skill's description
      // ("Issue, query, and refund invoices") to outscore the guarded skill.
      const result = await mcp.tools.call('search_skill', { query: 'refund invoice' });
      expect(result).toBeSuccessful();
      const json = result.json<SearchSkillResponse>();
      const ids = json.skills.map((s) => s.skillId);
      expect(ids).toContain('invoices');
      // bundleVersion is verified separately via load_skill where the full
      // SkillContent (rather than the search-provider metadata) is returned.
    });

    test('honors the limit parameter', async ({ mcp }) => {
      const result = await mcp.tools.call('search_skill', { query: 'invoice refund admin', limit: 1 });
      expect(result).toBeSuccessful();
      const json = result.json<SearchSkillResponse>();
      expect(json.skills.length).toBeLessThanOrEqual(1);
    });
  });

  test.describe('load_skill', () => {
    test('returns instructions plus actions[] with schemas', async ({ mcp }) => {
      const result = await mcp.tools.call('load_skill', { skillId: 'invoices' });
      expect(result).toBeSuccessful();
      const json = result.json<LoadSkillResponse>();
      expect(json.skill.id).toBe('invoices');
      expect(json.skill.bundleVersion).toBe('1.0.0');
      expect(json.skill.instructions).toContain('Invoices skill');
      expect(json.skill.actions?.map((a) => a.actionId).sort()).toEqual([
        'createInvoice',
        'getInvoice',
        'refundInvoice',
      ]);
    });

    test('throws for unknown skill ids (surfaces as MCP error)', async ({ mcp }) => {
      const result = await mcp.tools.call('load_skill', { skillId: 'does-not-exist' });
      expect(result.isError).toBe(true);
    });
  });

  test.describe('run_workflow — happy path', () => {
    test('createInvoice → getInvoice → refundInvoice round-trip in one script', async ({ mcp }) => {
      const result = await mcp.tools.call('run_workflow', {
        script: [
          "const created = await callTool('createInvoice', { customerId: 'cus_e2e', amount: 1234 });",
          "const fetched = await callTool('getInvoice', { id: created.id });",
          "const refund = await callTool('refundInvoice', { id: created.id, amount: 1234 });",
          'return { created: created, fetched: fetched, refund: refund };',
        ].join('\n'),
      });
      expect(result).toBeSuccessful();
      const json = result.json<RunWorkflowResponse>();
      expect(json.error).toBeUndefined();
      expect(json.success).toBe(true);
      const value = json.value as {
        created: { id: string; status: string };
        fetched: { id: string; status: string; amount: number };
        refund: { invoiceId: string };
      };
      expect(value.created.status).toBe('open');
      expect(value.fetched).toEqual({ id: value.created.id, status: 'open', amount: 1234 });
      expect(value.refund.invoiceId).toBe(value.created.id);
    });
  });

  test.describe('run_workflow — error paths', () => {
    test('unknown action comes back as success:false with the reason', async ({ mcp }) => {
      const result = await mcp.tools.call('run_workflow', { script: "return await callTool('doesNotExist', {});" });
      const json = result.json<RunWorkflowResponse>();
      expect(json.success).toBe(false);
      expect(json.error).toMatch(/unknown action/);
    });

    test('missing required path param is caught by the input schema gate', async ({ mcp }) => {
      const result = await mcp.tools.call('run_workflow', { script: "return await callTool('getInvoice', {});" });
      const json = result.json<RunWorkflowResponse>();
      expect(json.success).toBe(false);
      expect(json.error).toMatch(/input validation failed.*id/i);
    });

    test('ABAC denial — adminPing requires admin role; public sessions are denied', async ({ mcp }) => {
      const result = await mcp.tools.call('run_workflow', { script: "return await callTool('adminPing', {});" });
      const json = result.json<RunWorkflowResponse>();
      expect(json.success).toBe(false);
      expect(json.error).toMatch(/authority denied/);
    });
  });
});
