/**
 * E2E: CodeCall's tool-access policy (GHSA-6w3j-82v5-6qrr).
 *
 * The CRM app configures `includeTools: (tool) => !tool.name.startsWith('admin:')` and
 * `directCalls.allowedTools: ['users-list', 'users-get']`, and registers three tools the policy
 * withholds: `admin:purge-users`, `system:wipe-config` and `users-export`
 * (`enabledInCodeCall: false`). The app id is `CRM`, so the SDK also knows the first one as
 * `CRM:admin:purge-users`, which is the spelling execution used to judge.
 */
import { expect, test } from '@frontmcp/testing';

interface CodeCallExecuteResult<T> {
  status: string;
  result?: T;
}

interface UsersListResult {
  count: number;
}

interface DescribeResult {
  tools: Array<{ name: string }>;
  notFound?: string[];
}

interface SearchResult {
  tools: Array<{ name: string }>;
}

const WITHHELD_TOOLS = ['admin:purge-users', 'CRM:admin:purge-users', 'system:wipe-config', 'users-export'];

test.describe('CodeCall access control E2E (GHSA-6w3j-82v5-6qrr)', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-codecall/src/main.ts',
    project: 'demo-e2e-codecall',
    publicMode: true,
  });

  test.describe('reported attacks are refused', () => {
    test('codecall:execute cannot call a tool the includeTools filter excludes', async ({ mcp }) => {
      await mcp.tools.call('crm-reset', {});

      const attack = await mcp.tools.call('codecall:execute', {
        script: `return await callTool('admin:purge-users', {});`,
      });
      const after = await mcp.tools.call('codecall:execute', {
        script: `return await callTool('users-list', {});`,
      });

      expect(attack.json<CodeCallExecuteResult<unknown>>().status).not.toBe('ok');
      expect(after.json<CodeCallExecuteResult<UsersListResult>>().result?.count).toBe(3);
    });

    test('codecall:execute cannot call a tool in the system: namespace', async ({ mcp }) => {
      await mcp.tools.call('crm-reset', {});

      const attack = await mcp.tools.call('codecall:execute', {
        script: `return await callTool('system:wipe-config', {});`,
      });
      const after = await mcp.tools.call('codecall:execute', {
        script: `return await callTool('users-list', {});`,
      });

      expect(attack.json<CodeCallExecuteResult<unknown>>().status).not.toBe('ok');
      expect(after.json<CodeCallExecuteResult<UsersListResult>>().result?.count).toBe(3);
    });

    test('codecall:invoke cannot call a tool missing from directCalls.allowedTools', async ({ mcp }) => {
      await mcp.tools.call('crm-reset', {});

      const attack = await mcp.tools.call('codecall:invoke', { tool: 'users-delete', input: { id: 'user-1' } });
      const after = await mcp.tools.call('codecall:execute', {
        script: `return await callTool('users-get', { id: 'user-1' });`,
      });

      expect(attack.isError).toBe(true);
      expect(after.json<CodeCallExecuteResult<unknown>>().status).toBe('ok');
    });

    test('no CodeCall surface reaches a withheld tool', async ({ mcp }) => {
      for (const toolName of WITHHELD_TOOLS) {
        const executed = await mcp.tools.call('codecall:execute', {
          script: `return await callTool('${toolName}', {});`,
        });
        const invoked = await mcp.tools.call('codecall:invoke', { tool: toolName, input: {} });

        expect(executed.json<CodeCallExecuteResult<unknown>>().status).not.toBe('ok');
        expect(invoked.isError).toBe(true);
      }

      const described = await mcp.tools.call('codecall:describe', { toolNames: WITHHELD_TOOLS });
      expect(described.json<DescribeResult>().notFound).toEqual(WITHHELD_TOOLS);

      const searched = await mcp.tools.call('codecall:search', {
        queries: ['purge users', 'wipe config', 'export user emails'],
        topK: 20,
        minRelevanceScore: 0,
      });
      const foundNames = searched.json<SearchResult>().tools.map((tool) => tool.name);
      for (const toolName of WITHHELD_TOOLS) {
        expect(foundNames).not.toContain(toolName);
      }
    });
  });

  test.describe('allowed tools keep working', () => {
    test('codecall:execute still runs an allowed tool', async ({ mcp }) => {
      await mcp.tools.call('crm-reset', {});

      const result = await mcp.tools.call('codecall:execute', {
        script: `return await callTool('users-list', {});`,
      });

      expect(result).toBeSuccessful();
      const execResult = result.json<CodeCallExecuteResult<UsersListResult>>();
      expect(execResult.status).toBe('ok');
      expect(execResult.result?.count).toBe(3);
    });

    test('codecall:invoke runs a tool listed in directCalls.allowedTools by its bare name', async ({ mcp }) => {
      await mcp.tools.call('crm-reset', {});

      const result = await mcp.tools.call('codecall:invoke', { tool: 'users-list', input: {} });

      expect(result).toBeSuccessful();
      expect(result.json<UsersListResult>().count).toBe(3);
    });

    test('codecall:invoke still refuses a CodeCall meta-tool', async ({ mcp }) => {
      const result = await mcp.tools.call('codecall:invoke', { tool: 'codecall:execute', input: { script: '1' } });

      expect(result.isError).toBe(true);
    });
  });
});
