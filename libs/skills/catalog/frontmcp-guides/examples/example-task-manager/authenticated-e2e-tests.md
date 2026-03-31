---
name: authenticated-e2e-tests
reference: example-task-manager
level: advanced
description: 'Shows how to write E2E tests with authentication using `TestTokenFactory`, and unit tests for tools that require session context.'
tags: [guides, auth, session, e2e, unit-test, task-manager]
features:
  - 'Using `TestTokenFactory` to create JWT tokens for authenticated E2E tests'
  - 'Chaining `.withToken(token).buildAndConnect()` for authenticated clients'
  - 'Unit testing with mocked DI tokens via `this.get()` mock'
  - 'Mocking session context (`context: { session: { userId } }`) for auth-dependent tools'
  - 'Testing the unauthenticated error path (no session)'
---

# Task Manager: Authenticated E2E Tests

Shows how to write E2E tests with authentication using `TestTokenFactory`, and unit tests for tools that require session context.

## Code

```typescript
// test/tasks.e2e.spec.ts
import { McpTestClient, TestServer, TestTokenFactory } from '@frontmcp/testing';

describe('Task Manager E2E', () => {
  let client: McpTestClient;
  let server: TestServer;

  beforeAll(async () => {
    server = await TestServer.start({ command: 'npx tsx src/main.ts' });

    // Create a test token for authenticated requests
    const tokenFactory = new TestTokenFactory();
    const token = await tokenFactory.createTestToken({ sub: 'user-e2e', scopes: ['tasks'] });

    // Build client with the auth token
    client = await McpTestClient.create({ baseUrl: server.info.baseUrl }).withToken(token).buildAndConnect();
  });

  afterAll(async () => {
    await client.disconnect();
    await server.stop();
  });

  it('should list all CRUD tools', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);

    expect(names).toContain('create_task');
    expect(names).toContain('list_tasks');
    expect(names).toContain('update_task');
    expect(names).toContain('delete_task');
  });

  it('should create and list a task', async () => {
    const createResult = await client.callTool('create_task', {
      title: 'E2E test task',
      priority: 'high',
    });
    expect(createResult).toBeSuccessful();

    const listResult = await client.callTool('list_tasks', {});
    expect(listResult).toBeSuccessful();

    const parsed = JSON.parse(listResult.content[0].text);
    expect(parsed.tasks.length).toBeGreaterThan(0);
    expect(parsed.tasks.some((t: { title: string }) => t.title === 'E2E test task')).toBe(true);
  });
});
```

```typescript
// test/create-task.tool.spec.ts — Unit test with mocked session
import { ToolContext } from '@frontmcp/sdk';
import { CreateTaskTool } from '../src/tools/create-task.tool';
import { TASK_STORE, type TaskStore } from '../src/providers/task-store.provider';
import type { Task } from '../src/types/task';

describe('CreateTaskTool', () => {
  let tool: CreateTaskTool;
  let mockStore: jest.Mocked<TaskStore>;

  beforeEach(() => {
    tool = new CreateTaskTool();
    mockStore = {
      create: jest.fn(),
      list: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };
  });

  function applyContext(userId: string | undefined): void {
    const ctx = {
      get: jest.fn((token: symbol) => {
        if (token === TASK_STORE) return mockStore;
        throw new Error(`Unknown token: ${String(token)}`);
      }),
      tryGet: jest.fn(),
      fail: jest.fn((err: Error) => {
        throw err;
      }),
      mark: jest.fn(),
      notify: jest.fn(),
      respondProgress: jest.fn(),
      context: { session: userId ? { userId } : undefined },
    } as unknown as ToolContext;
    Object.assign(tool, ctx);
  }

  it('should create a task for an authenticated user', async () => {
    const mockTask: Task = {
      id: 'task-001',
      title: 'Write tests',
      priority: 'high',
      status: 'pending',
      userId: 'user-123',
      createdAt: '2026-03-27T10:00:00.000Z',
    };
    mockStore.create.mockResolvedValue(mockTask);
    applyContext('user-123');

    const result = await tool.execute({ title: 'Write tests', priority: 'high' });

    expect(result.id).toBe('task-001');
    expect(result.title).toBe('Write tests');
    expect(mockStore.create).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-123', status: 'pending' }));
  });

  it('should fail when user is not authenticated', async () => {
    applyContext(undefined);

    await expect(tool.execute({ title: 'Write tests', priority: 'medium' })).rejects.toThrow('Authentication required');
  });
});
```

## What This Demonstrates

- Using `TestTokenFactory` to create JWT tokens for authenticated E2E tests
- Chaining `.withToken(token).buildAndConnect()` for authenticated clients
- Unit testing with mocked DI tokens via `this.get()` mock
- Mocking session context (`context: { session: { userId } }`) for auth-dependent tools
- Testing the unauthenticated error path (no session)

## Related

- See `example-task-manager` for the full task manager example with server setup and Vercel deployment
