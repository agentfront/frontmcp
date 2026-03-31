---
name: example-task-manager
description: Authenticated task management server with CRUD tools, Redis storage, OAuth, and Vercel deployment
---

# Example: Task Manager (Intermediate)

> Skills used: setup-project, create-tool, create-provider, configure-auth, configure-session, setup-redis, setup-testing, deploy-to-vercel

An authenticated task management MCP server with CRUD tools, a Redis-backed provider for storage, OAuth authentication, and Vercel deployment. Demonstrates DI with tokens, session management, per-user data isolation, and authenticated E2E testing.

---

## Project Setup

```jsonc
// package.json
{
  "name": "task-manager",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "build": "frontmcp build --target vercel",
    "start": "frontmcp start",
    "test": "jest --coverage",
  },
  "dependencies": {
    "@frontmcp/sdk": "^1.0.0",
    "ioredis": "^5.4.0",
    "zod": "^3.23.0",
  },
  "devDependencies": {
    "@frontmcp/testing": "^1.0.0",
    "jest": "^29.0.0",
    "ts-jest": "^29.0.0",
    "typescript": "^5.4.0",
  },
}
```

---

## Server Entry Point

```typescript
// src/main.ts
import { FrontMcp } from '@frontmcp/sdk';
import { TasksApp } from './tasks.app';

@FrontMcp({
  info: { name: 'task-manager', version: '1.0.0' },
  apps: [TasksApp],
  auth: { mode: 'remote', provider: 'https://auth.example.com', clientId: 'my-client-id' },
  redis: { provider: 'redis', host: process.env.REDIS_URL ?? 'localhost' },
})
export default class TaskManagerServer {}
```

---

## App Registration

```typescript
// src/tasks.app.ts
import { App } from '@frontmcp/sdk';
import { RedisTaskStoreProvider } from './providers/task-store.provider';
import { CreateTaskTool } from './tools/create-task.tool';
import { ListTasksTool } from './tools/list-tasks.tool';
import { UpdateTaskTool } from './tools/update-task.tool';
import { DeleteTaskTool } from './tools/delete-task.tool';

@App({
  name: 'Tasks',
  description: 'Task management with CRUD operations',
  providers: [RedisTaskStoreProvider],
  tools: [CreateTaskTool, ListTasksTool, UpdateTaskTool, DeleteTaskTool],
})
export class TasksApp {}
```

---

## Shared Types

```typescript
// src/types/task.ts
export interface Task {
  id: string;
  title: string;
  priority: 'low' | 'medium' | 'high';
  status: 'pending' | 'in_progress' | 'done';
  userId: string;
  createdAt: string;
}
```

---

## Provider: Redis Task Store

```typescript
// src/providers/task-store.provider.ts
import { Provider } from '@frontmcp/sdk';
import type { Token } from '@frontmcp/di';
import type { Task } from '../types/task';

export interface TaskStore {
  create(task: Omit<Task, 'id' | 'createdAt'>): Promise<Task>;
  list(userId: string): Promise<Task[]>;
  update(id: string, userId: string, data: Partial<Pick<Task, 'title' | 'priority' | 'status'>>): Promise<Task>;
  delete(id: string, userId: string): Promise<void>;
}

export const TASK_STORE: Token<TaskStore> = Symbol('TaskStore');

@Provider({ token: TASK_STORE })
export class RedisTaskStoreProvider implements TaskStore {
  private redis!: import('ioredis').default;

  async onInit(): Promise<void> {
    const Redis = (await import('ioredis')).default;
    this.redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
  }

  async create(input: Omit<Task, 'id' | 'createdAt'>): Promise<Task> {
    const { randomUUID } = await import('@frontmcp/utils');
    const task: Task = {
      ...input,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    };
    await this.redis.hset(`tasks:${task.userId}`, task.id, JSON.stringify(task));
    return task;
  }

  async list(userId: string): Promise<Task[]> {
    const entries = await this.redis.hgetall(`tasks:${userId}`);
    return Object.values(entries).map((v) => JSON.parse(v) as Task);
  }

  async update(id: string, userId: string, data: Partial<Pick<Task, 'title' | 'priority' | 'status'>>): Promise<Task> {
    const raw = await this.redis.hget(`tasks:${userId}`, id);
    if (!raw) {
      throw new Error(`Task not found: ${id}`);
    }
    const task: Task = { ...(JSON.parse(raw) as Task), ...data };
    await this.redis.hset(`tasks:${userId}`, id, JSON.stringify(task));
    return task;
  }

  async delete(id: string, userId: string): Promise<void> {
    const removed = await this.redis.hdel(`tasks:${userId}`, id);
    if (removed === 0) {
      throw new Error(`Task not found: ${id}`);
    }
  }

  async onDestroy(): Promise<void> {
    await this.redis.quit();
  }
}
```

---

## Tool: Create Task

```typescript
// src/tools/create-task.tool.ts
import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';
import { TASK_STORE } from '../providers/task-store.provider';

@Tool({
  name: 'create_task',
  description: 'Create a new task for the authenticated user',
  inputSchema: {
    title: z.string().min(1).max(200).describe('Task title'),
    priority: z.enum(['low', 'medium', 'high']).default('medium').describe('Task priority'),
  },
  outputSchema: {
    id: z.string(),
    title: z.string(),
    priority: z.string(),
    status: z.string(),
    createdAt: z.string(),
  },
})
export class CreateTaskTool extends ToolContext {
  async execute(input: { title: string; priority: 'low' | 'medium' | 'high' }) {
    const store = this.get(TASK_STORE);
    const userId = this.context.session?.userId;

    if (!userId) {
      this.fail(new Error('Authentication required'));
    }

    const task = await store.create({
      title: input.title,
      priority: input.priority,
      status: 'pending',
      userId,
    });

    return {
      id: task.id,
      title: task.title,
      priority: task.priority,
      status: task.status,
      createdAt: task.createdAt,
    };
  }
}
```

---

## Tool: List Tasks

```typescript
// src/tools/list-tasks.tool.ts
import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';
import { TASK_STORE } from '../providers/task-store.provider';

@Tool({
  name: 'list_tasks',
  description: 'List all tasks for the authenticated user',
  inputSchema: {
    status: z.enum(['pending', 'in_progress', 'done']).optional().describe('Filter by status'),
  },
  outputSchema: {
    tasks: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        priority: z.string(),
        status: z.string(),
        createdAt: z.string(),
      }),
    ),
    total: z.number(),
  },
})
export class ListTasksTool extends ToolContext {
  async execute(input: { status?: 'pending' | 'in_progress' | 'done' }) {
    const store = this.get(TASK_STORE);
    const userId = this.context.session?.userId;

    if (!userId) {
      this.fail(new Error('Authentication required'));
    }

    let tasks = await store.list(userId);

    if (input.status) {
      tasks = tasks.filter((t) => t.status === input.status);
    }

    return {
      tasks: tasks.map((t) => ({
        id: t.id,
        title: t.title,
        priority: t.priority,
        status: t.status,
        createdAt: t.createdAt,
      })),
      total: tasks.length,
    };
  }
}
```

---

## Tool: Update Task

```typescript
// src/tools/update-task.tool.ts
import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';
import { TASK_STORE } from '../providers/task-store.provider';

@Tool({
  name: 'update_task',
  description: 'Update the status or priority of an existing task',
  inputSchema: {
    id: z.string().min(1).describe('Task ID to update'),
    status: z.enum(['pending', 'in_progress', 'done']).optional().describe('New status'),
    priority: z.enum(['low', 'medium', 'high']).optional().describe('New priority'),
  },
  outputSchema: {
    id: z.string(),
    title: z.string(),
    priority: z.string(),
    status: z.string(),
  },
})
export class UpdateTaskTool extends ToolContext {
  async execute(input: {
    id: string;
    status?: 'pending' | 'in_progress' | 'done';
    priority?: 'low' | 'medium' | 'high';
  }) {
    const store = this.get(TASK_STORE);
    const userId = this.context.session?.userId;

    if (!userId) {
      this.fail(new Error('Authentication required'));
    }

    // No try/catch needed — the framework handles errors in the tool execution flow.
    const updated = await store.update(input.id, userId, {
      ...(input.status && { status: input.status }),
      ...(input.priority && { priority: input.priority }),
    });

    return {
      id: updated.id,
      title: updated.title,
      priority: updated.priority,
      status: updated.status,
    };
  }
}
```

---

## Tool: Delete Task

```typescript
// src/tools/delete-task.tool.ts
import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';
import { TASK_STORE } from '../providers/task-store.provider';

@Tool({
  name: 'delete_task',
  description: 'Delete a task by ID',
  inputSchema: {
    id: z.string().min(1).describe('Task ID to delete'),
  },
  outputSchema: {
    deleted: z.boolean(),
    id: z.string(),
  },
})
export class DeleteTaskTool extends ToolContext {
  async execute(input: { id: string }) {
    const store = this.get(TASK_STORE);
    const userId = this.context.session?.userId;

    if (!userId) {
      this.fail(new Error('Authentication required'));
    }

    // No try/catch needed — the framework handles errors in the tool execution flow.
    await store.delete(input.id, userId);
    return { deleted: true, id: input.id };
  }
}
```

---

## Vercel Deployment Config

```jsonc
// vercel.json
{
  "version": 2,
  "builds": [{ "src": "api/**/*.ts", "use": "@vercel/node" }],
  "routes": [{ "src": "/mcp/(.*)", "dest": "/api/mcp" }],
  "env": {
    "REDIS_URL": "@redis-url",
  },
}
```

---

## Unit Test: CreateTaskTool

```typescript
// test/create-task.tool.spec.ts
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

    expect(result).toEqual({
      id: 'task-001',
      title: 'Write tests',
      priority: 'high',
      status: 'pending',
      createdAt: '2026-03-27T10:00:00.000Z',
    });
    expect(mockStore.create).toHaveBeenCalledWith({
      title: 'Write tests',
      priority: 'high',
      status: 'pending',
      userId: 'user-123',
    });
  });

  it('should fail when user is not authenticated', async () => {
    applyContext(undefined);

    await expect(tool.execute({ title: 'Write tests', priority: 'medium' })).rejects.toThrow('Authentication required');
  });
});
```

---

## E2E Test: Task Manager

```typescript
// test/tasks.e2e.spec.ts
import { McpTestClient, TestServer, TestTokenFactory } from '@frontmcp/testing';
import Server from '../src/main';

describe('Task Manager E2E', () => {
  let client: McpTestClient;
  let server: TestServer;

  beforeAll(async () => {
    server = await TestServer.start({ command: 'npx tsx src/main.ts' });
    const tokenFactory = new TestTokenFactory();
    const token = await tokenFactory.createTestToken({ sub: 'user-e2e', scopes: ['tasks'] });
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

## Examples

| Example                                                                                  | Level        | Description                                                                                                                                    |
| ---------------------------------------------------------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| [`auth-and-crud-tools`](../examples/example-task-manager/auth-and-crud-tools.md)         | Basic        | Shows how to create CRUD tools with authentication, using `this.context.session` for user isolation and `this.get()` for dependency injection. |
| [`authenticated-e2e-tests`](../examples/example-task-manager/authenticated-e2e-tests.md) | Advanced     | Shows how to write E2E tests with authentication using `TestTokenFactory`, and unit tests for tools that require session context.              |
| [`redis-provider-with-di`](../examples/example-task-manager/redis-provider-with-di.md)   | Intermediate | Shows how to create a Redis-backed provider with a DI token, lifecycle hooks (`onInit`/`onDestroy`), and how tools inject it.                  |

> See all examples in [`examples/example-task-manager/`](../examples/example-task-manager/)
