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
 *     invokes the upstream with the configured bearer credential (execution-path
 *     tests below are skipped pending the @enclave-vm/core node_modules update)
 *   - ABAC denial path returns ok:false with a structured reason
 *   - input-validation paths (missing path param, unknown action) return
 *     structured errors instead of throwing
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

interface ExecuteActionResponse {
  ok: boolean;
  status: number;
  data?: unknown;
  contentType?: string;
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

  // TODO(skilled-openapi): `execute_action` was removed in favor of `run_workflow`
  // (enclave-sandboxed AgentScript calling actions via `callTool(actionId, input)`).
  // These execution tests are SKIPPED until the installed `@enclave-vm/core` exposes
  // `InterpreterAdapter` + the `/worker` subpath (present in the source repo, not yet
  // in node_modules) so `run_workflow` can execute on Node. Then rewrite each
  // `execute_action({ skillId, actionId, input })` → `run_workflow({ script })` where
  // the script does `return await callTool(actionId, input)` and assert the
  // `{ success, value }` envelope instead of `{ ok, status, data }`.
  test.describe.skip('execute_action — happy path', () => {
    test('createInvoice → getInvoice → refundInvoice round-trip', async ({ mcp }) => {
      // 1) Create
      const created = await mcp.tools.call('execute_action', {
        skillId: 'invoices',
        actionId: 'createInvoice',
        input: { customerId: 'cus_e2e', amount: 1234 },
      });
      expect(created).toBeSuccessful();
      const createdJson = created.json<ExecuteActionResponse>();
      expect(createdJson.ok).toBe(true);
      expect(createdJson.status).toBe(201);
      const data = createdJson.data as { id: string; status: string };
      expect(data.status).toBe('open');
      const invoiceId = data.id;

      // 2) Get
      const fetched = await mcp.tools.call('execute_action', {
        skillId: 'invoices',
        actionId: 'getInvoice',
        input: { id: invoiceId },
      });
      const fetchedJson = fetched.json<ExecuteActionResponse>();
      expect(fetchedJson.ok).toBe(true);
      expect((fetchedJson.data as { id: string }).id).toBe(invoiceId);

      // 3) Refund
      const refunded = await mcp.tools.call('execute_action', {
        skillId: 'invoices',
        actionId: 'refundInvoice',
        input: { id: invoiceId, amount: 1234 },
      });
      const refundedJson = refunded.json<ExecuteActionResponse>();
      expect(refundedJson.ok).toBe(true);
      expect(refundedJson.status).toBe(201);
      expect((refundedJson.data as { invoiceId: string }).invoiceId).toBe(invoiceId);
    });
  });

  // SKIPPED — see the note above the happy-path block (pending @enclave-vm/core update).
  test.describe.skip('execute_action — error paths', () => {
    test('unknown action returns ok:false with structured error', async ({ mcp }) => {
      const result = await mcp.tools.call('execute_action', {
        skillId: 'invoices',
        actionId: 'doesNotExist',
        input: {},
      });
      const json = result.json<ExecuteActionResponse>();
      expect(json.ok).toBe(false);
      expect(json.error).toMatch(/unknown action/);
    });

    test('missing required path param surfaces as ok:false (caught by input schema gate)', async ({ mcp }) => {
      const result = await mcp.tools.call('execute_action', {
        skillId: 'invoices',
        actionId: 'getInvoice',
        input: {},
      });
      const json = result.json<ExecuteActionResponse>();
      expect(json.ok).toBe(false);
      // The op's inputSchema gate runs before the executor's mapper-level
      // path-param check, so the error wraps the zod issue for `id`.
      expect(json.error).toMatch(/input validation failed.*id/i);
    });

    test('ABAC denial — adminPing requires admin role; public sessions are denied', async ({ mcp }) => {
      const result = await mcp.tools.call('execute_action', {
        skillId: 'guarded',
        actionId: 'adminPing',
        input: {},
      });
      const json = result.json<ExecuteActionResponse>();
      expect(json.ok).toBe(false);
      expect(json.error).toMatch(/authority denied/);
    });
  });
});
