---
name: redis-provider-with-di
reference: example-task-manager
level: intermediate
description: 'Shows how to create a Redis-backed provider with a DI token, lifecycle hooks (`onInit`/`onDestroy`), and how tools inject it.'
tags: [guides, redis, node, task-manager, task, manager]
features:
  - "Defining an interface and DI token (`Symbol('TaskStore')`) for the provider"
  - 'Using `@Provider({ token: TASK_STORE })` to register the provider for DI'
  - 'Lifecycle hooks: `onInit()` for connection setup, `onDestroy()` for cleanup'
  - 'Lazy-loading `ioredis` via dynamic `import()` in `onInit()`'
  - 'Using `@frontmcp/utils` for `randomUUID()` instead of `node:crypto`'
  - 'Per-user data isolation using Redis hash keys (`tasks:${userId}`)'
---

# Task Manager: Redis Provider with Dependency Injection

Shows how to create a Redis-backed provider with a DI token, lifecycle hooks (`onInit`/`onDestroy`), and how tools inject it.

## Code

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

// DI token — tools use this.get(TASK_STORE) to access the provider
export const TASK_STORE: Token<TaskStore> = Symbol('TaskStore');

@Provider({ token: TASK_STORE })
export class RedisTaskStoreProvider implements TaskStore {
  private redis!: import('ioredis').default;

  // Lifecycle: initialize Redis connection
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

  // Lifecycle: close Redis connection on shutdown
  async onDestroy(): Promise<void> {
    await this.redis.quit();
  }
}
```

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

## What This Demonstrates

- Defining an interface and DI token (`Symbol('TaskStore')`) for the provider
- Using `@Provider({ token: TASK_STORE })` to register the provider for DI
- Lifecycle hooks: `onInit()` for connection setup, `onDestroy()` for cleanup
- Lazy-loading `ioredis` via dynamic `import()` in `onInit()`
- Using `@frontmcp/utils` for `randomUUID()` instead of `node:crypto`
- Per-user data isolation using Redis hash keys (`tasks:${userId}`)

## Related

- See `example-task-manager` for the full task manager example with auth and E2E tests
