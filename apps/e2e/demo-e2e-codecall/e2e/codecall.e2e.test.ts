/**
 * E2E Tests for CodeCall Plugin
 *
 * Tests the CodeCall plugin for AI orchestration:
 * - Meta-tools are exposed (search, describe, execute, invoke)
 * - Tool discovery and execution via CodeCall
 */
import { test, expect } from '@frontmcp/testing';

// Expected seed data from crm.store.ts
const SEED_USERS = [
  { id: 'user-1', name: 'John Doe', email: 'john@acme.com', company: 'Acme Inc', role: 'CEO' },
  { id: 'user-2', name: 'Jane Smith', email: 'jane@globex.com', company: 'Globex Corp', role: 'CTO' },
  { id: 'user-3', name: 'Bob Johnson', email: 'bob@initech.com', company: 'Initech', role: 'Manager' },
];

const SEED_ACTIVITY_STATS = {
  total: 3,
  byType: { call: 1, email: 1, meeting: 1 },
  byUser: { 'user-1': 2, 'user-2': 1 },
};

// Type for codecall:execute result
interface CodeCallExecuteResult<T> {
  status: 'ok' | 'error' | 'timeout' | 'runtime_error' | 'syntax_error' | 'tool_error' | 'illegal_access';
  result?: T;
  error?: unknown;
  logs?: string[];
}

// Type for codecall:search result
interface CodeCallSearchResult {
  tools: Array<{
    name: string;
    appId: string;
    description: string;
    relevanceScore: number;
    matchedQueries: string[];
  }>;
  warnings?: Array<{ type: string; message: string }>;
  totalAvailableTools: number;
}

test.describe('CodeCall Plugin E2E', () => {
  test.use({
    server: './src/main.ts',
    publicMode: true,
  });

  test.describe('Meta-Tools Exposure', () => {
    test('should expose CodeCall meta-tools', async ({ mcp }) => {
      const tools = await mcp.tools.list();

      expect(tools).toContainTool('codecall:search');
      expect(tools).toContainTool('codecall:describe');
      expect(tools).toContainTool('codecall:execute');
    });

    test('should have CRM tools available for CodeCall execution', async ({ mcp }) => {
      // In codecall_only mode, tools are searchable via CodeCall even if visible in list
      const result = await mcp.tools.call('codecall:search', {
        queries: ['list users'],
      });

      expect(result).toBeSuccessful();
      const searchResult = result.json<CodeCallSearchResult>();
      expect(searchResult.tools.length).toBeGreaterThan(0);
      expect(searchResult.tools.some((t) => t.name === 'users-list')).toBe(true);
    });
  });

  test.describe('Tool Search', () => {
    test('should search for user tools and return matching results with scores', async ({ mcp }) => {
      const result = await mcp.tools.call('codecall:search', {
        queries: ['list users'],
      });

      expect(result).toBeSuccessful();
      const searchResult = result.json<CodeCallSearchResult>();

      // Verify search result structure
      expect(searchResult.tools).toBeDefined();
      expect(searchResult.tools.length).toBeGreaterThan(0);
      expect(searchResult.totalAvailableTools).toBe(8); // 8 CRM tools

      // Verify users-list is found with relevance score
      const usersList = searchResult.tools.find((t) => t.name === 'users-list');
      expect(usersList).toBeDefined();
      expect(usersList?.relevanceScore).toBeGreaterThan(0);
      expect(usersList?.matchedQueries).toContain('list users');
    });

    test('should search for activity tools with multiple queries', async ({ mcp }) => {
      const result = await mcp.tools.call('codecall:search', {
        queries: ['log activity', 'activity stats'],
      });

      expect(result).toBeSuccessful();
      const searchResult = result.json<CodeCallSearchResult>();

      // Both activity-related tools should be found
      const toolNames = searchResult.tools.map((t) => t.name);
      expect(toolNames).toContain('activities-log');
      expect(toolNames).toContain('activities-stats');
    });

    test('should respect topK parameter', async ({ mcp }) => {
      const result = await mcp.tools.call('codecall:search', {
        queries: ['user management'],
        topK: 2,
      });

      expect(result).toBeSuccessful();
      const searchResult = result.json<CodeCallSearchResult>();
      // Results should be limited by topK
      expect(searchResult.tools.length).toBeLessThanOrEqual(2);
    });

    test('should find create tool when searching for creation', async ({ mcp }) => {
      const result = await mcp.tools.call('codecall:search', {
        queries: ['create new user'],
      });

      expect(result).toBeSuccessful();
      const searchResult = result.json<CodeCallSearchResult>();
      const usersCreate = searchResult.tools.find((t) => t.name === 'users-create');
      expect(usersCreate).toBeDefined();
      expect(usersCreate?.description).toContain('Create');
    });
  });

  test.describe('Tool Description', () => {
    test('should describe tools with full schema information', async ({ mcp }) => {
      const result = await mcp.tools.call('codecall:describe', {
        toolNames: ['users-list', 'users-create'],
      });

      expect(result).toBeSuccessful();
      // Tool names should be present
      expect(result).toHaveTextContent('users-list');
      expect(result).toHaveTextContent('users-create');
      // Description should be present
      expect(result).toHaveTextContent('List all users');
      expect(result).toHaveTextContent('Create a new user');
    });

    test('should include input schema properties for users-create', async ({ mcp }) => {
      const result = await mcp.tools.call('codecall:describe', {
        toolNames: ['users-create'],
      });

      expect(result).toBeSuccessful();
      // Input schema properties
      expect(result).toHaveTextContent('name');
      expect(result).toHaveTextContent('email');
      expect(result).toHaveTextContent('company');
      expect(result).toHaveTextContent('role');
    });

    test('should include output schema information', async ({ mcp }) => {
      const result = await mcp.tools.call('codecall:describe', {
        toolNames: ['activities-stats'],
      });

      expect(result).toBeSuccessful();
      // Output schema should describe the stats structure
      expect(result).toHaveTextContent('total');
      expect(result).toHaveTextContent('byType');
      expect(result).toHaveTextContent('byUser');
    });
  });

  test.describe('Tool Execution', () => {
    test('should execute users-list and return seed data', async ({ mcp }) => {
      const result = await mcp.tools.call('codecall:execute', {
        script: `
          const result = await callTool('users-list', {});
          return result;
        `,
      });

      expect(result).toBeSuccessful();
      const execResult = result.json<CodeCallExecuteResult<{ users: typeof SEED_USERS; count: number }>>();
      expect(execResult.status).toBe('ok');
      if (!execResult.result) throw new Error('Expected result to be defined');

      const data = execResult.result;
      expect(data.count).toBe(3);
      expect(data.users).toHaveLength(3);
      expect(data.users[0].name).toBe('John Doe');
      expect(data.users[0].email).toBe('john@acme.com');
      expect(data.users[1].name).toBe('Jane Smith');
      expect(data.users[2].name).toBe('Bob Johnson');
    });

    test('should execute activities-stats and return correct counts', async ({ mcp }) => {
      const result = await mcp.tools.call('codecall:execute', {
        script: `
          const stats = await callTool('activities-stats', {});
          return stats;
        `,
      });

      expect(result).toBeSuccessful();
      const execResult = result.json<CodeCallExecuteResult<typeof SEED_ACTIVITY_STATS>>();
      expect(execResult.status).toBe('ok');
      if (!execResult.result) throw new Error('Expected result to be defined');

      const stats = execResult.result;
      expect(stats.total).toBe(3);
      expect(stats.byType.call).toBe(1);
      expect(stats.byType.email).toBe(1);
      expect(stats.byType.meeting).toBe(1);
      expect(stats.byUser['user-1']).toBe(2);
      expect(stats.byUser['user-2']).toBe(1);
    });

    test('should execute multiple tools and aggregate results', async ({ mcp }) => {
      const result = await mcp.tools.call('codecall:execute', {
        script: `
          const users = await callTool('users-list', {});
          const stats = await callTool('activities-stats', {});
          return {
            userCount: users.count,
            totalActivities: stats.total,
            userNames: users.users.map(u => u.name)
          };
        `,
      });

      expect(result).toBeSuccessful();
      const execResult =
        result.json<CodeCallExecuteResult<{ userCount: number; totalActivities: number; userNames: string[] }>>();
      expect(execResult.status).toBe('ok');
      if (!execResult.result) throw new Error('Expected result to be defined');

      const data = execResult.result;
      expect(data.userCount).toBe(3);
      expect(data.totalActivities).toBe(3);
      expect(data.userNames).toContain('John Doe');
      expect(data.userNames).toContain('Jane Smith');
      expect(data.userNames).toContain('Bob Johnson');
    });

    test('should get specific user by ID', async ({ mcp }) => {
      const result = await mcp.tools.call('codecall:execute', {
        script: `
          const user = await callTool('users-get', { id: 'user-1' });
          return user;
        `,
      });

      expect(result).toBeSuccessful();
      const execResult = result.json<CodeCallExecuteResult<{ user: (typeof SEED_USERS)[0] }>>();
      expect(execResult.status).toBe('ok');
      if (!execResult.result) throw new Error('Expected result to be defined');

      const data = execResult.result;
      expect(data.user.id).toBe('user-1');
      expect(data.user.name).toBe('John Doe');
      expect(data.user.company).toBe('Acme Inc');
      expect(data.user.role).toBe('CEO');
    });

    test('should create new user and verify creation', async ({ mcp }) => {
      const result = await mcp.tools.call('codecall:execute', {
        script: `
          const created = await callTool('users-create', {
            name: 'Test User',
            email: 'test@example.com',
            company: 'Test Corp',
            role: 'Developer'
          });
          return created;
        `,
      });

      expect(result).toBeSuccessful();
      const execResult = result.json<
        CodeCallExecuteResult<{
          user: { id: string; name: string; email: string; company: string; role: string; createdAt: string };
        }>
      >();
      expect(execResult.status).toBe('ok');
      if (!execResult.result) throw new Error('Expected result to be defined');

      const data = execResult.result;
      expect(data.user.name).toBe('Test User');
      expect(data.user.email).toBe('test@example.com');
      expect(data.user.company).toBe('Test Corp');
      expect(data.user.role).toBe('Developer');
      expect(data.user.id).toMatch(/^user-\d+$/);
      expect(data.user.createdAt).toBeDefined();
    });

    test('should list activities for specific user', async ({ mcp }) => {
      const result = await mcp.tools.call('codecall:execute', {
        script: `
          const activities = await callTool('activities-list', { userId: 'user-1' });
          return activities;
        `,
      });

      expect(result).toBeSuccessful();
      const execResult = result.json<
        CodeCallExecuteResult<{
          activities: Array<{ id: string; userId: string; type: string; description: string }>;
          count: number;
        }>
      >();
      expect(execResult.status).toBe('ok');
      if (!execResult.result) throw new Error('Expected result to be defined');

      const data = execResult.result;
      expect(data.count).toBe(2); // user-1 has 2 activities in seed data
      expect(data.activities.every((a) => a.userId === 'user-1')).toBe(true);
    });

    test('should handle tool execution errors gracefully', async ({ mcp }) => {
      const result = await mcp.tools.call('codecall:execute', {
        script: `
          const result = await callTool('nonexistent-tool', {});
          return result;
        `,
      });

      // The execute tool itself succeeds, but returns an error status
      expect(result).toBeSuccessful();
      const execResult = result.json<CodeCallExecuteResult<unknown>>();
      expect(execResult.status).not.toBe('ok');
    });

    test('should handle script errors gracefully', async ({ mcp }) => {
      const result = await mcp.tools.call('codecall:execute', {
        script: `
          throw new Error('Intentional test error');
        `,
      });

      // The execute tool itself succeeds, but returns an error status
      // Note: The AST validator may block certain patterns like 'throw', returning 'illegal_access'
      expect(result).toBeSuccessful();
      const execResult = result.json<CodeCallExecuteResult<unknown>>();
      expect(['runtime_error', 'illegal_access']).toContain(execResult.status);
    });
  });

  test.describe('Resource Access', () => {
    test('should list resources including crm://users', async ({ mcp }) => {
      const resources = await mcp.resources.list();
      expect(resources).toContainResource('crm://users');
    });

    test('should read users resource with full user data', async ({ mcp }) => {
      const content = await mcp.resources.read('crm://users');

      expect(content).toBeSuccessful();
      const data = content.json<{ users: typeof SEED_USERS; totalCount: number }>();
      // At least 3 seed users exist (more may exist from previous tests)
      expect(data.totalCount).toBeGreaterThanOrEqual(3);
      expect(data.users.length).toBeGreaterThanOrEqual(3);

      // Verify seed data structure - these users always exist
      const johnDoe = data.users.find((u) => u.id === 'user-1');
      expect(johnDoe).toBeDefined();
      expect(johnDoe?.name).toBe('John Doe');
      expect(johnDoe?.email).toBe('john@acme.com');
      expect(johnDoe?.company).toBe('Acme Inc');

      const janeSmith = data.users.find((u) => u.id === 'user-2');
      expect(janeSmith).toBeDefined();
      expect(janeSmith?.name).toBe('Jane Smith');

      const bobJohnson = data.users.find((u) => u.id === 'user-3');
      expect(bobJohnson).toBeDefined();
      expect(bobJohnson?.name).toBe('Bob Johnson');
    });
  });

  test.describe('Prompt Access', () => {
    test('should list prompts including analyze-user-activity', async ({ mcp }) => {
      const prompts = await mcp.prompts.list();
      expect(prompts).toContainPrompt('analyze-user-activity');
    });

    test('should get analysis prompt with activity data', async ({ mcp }) => {
      const result = await mcp.prompts.get('analyze-user-activity', {});

      expect(result).toBeSuccessful();
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].role).toBe('user');

      // Verify the prompt text contains expected content
      const messageContent = result.messages[0].content;
      expect(messageContent).toBeDefined();
      if (typeof messageContent === 'object' && 'text' in messageContent) {
        expect(messageContent.text).toContain('Total activities: 3');
        expect(messageContent.text).toContain('call');
        expect(messageContent.text).toContain('email');
        expect(messageContent.text).toContain('meeting');
      }
    });

    test('should filter activities by userId in prompt', async ({ mcp }) => {
      const result = await mcp.prompts.get('analyze-user-activity', { userId: 'user-1' });

      expect(result).toBeSuccessful();
      expect(result.description).toBe('Analyze 2 activities'); // user-1 has 2 activities
    });
  });
});
