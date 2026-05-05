---
name: redis-provider-with-di
reference: example-task-manager
level: intermediate
description: 'Shows how to create a Redis-backed provider using class-as-token DI plus an `AsyncProvider` factory for async setup, with `onDestroy()` cleanup, and how tools inject it.'
tags: [guides, redis, node, task-manager, task, manager]
features:
  - 'Class-as-token DI: `@Provider({ name, scope })` and inject via `this.get(TaskStoreProvider)`'
  - 'Building the singleton with `AsyncProvider({ provide, name, scope, useFactory })` for async setup'
  - 'Lifecycle: `onDestroy()` for graceful Redis cleanup on shutdown'
  - 'Using `@frontmcp/utils` for `randomUUID()` instead of `node:crypto`'
  - 'Per-user data isolation using Redis hash keys (`tasks:${userId}`)'
---

# Task Manager: Redis Provider with Dependency Injection

Shows how to create a Redis-backed provider using the class-as-token DI pattern (`@Provider({ name, scope })`) plus an `AsyncProvider` factory that runs the async Redis setup before any tool is invoked.

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
import Redis, { Redis as RedisClient } from 'ioredis';

import { AsyncProvider, Provider, ProviderScope } from '@frontmcp/sdk';
import { randomUUID } from '@frontmcp/utils';

import type { Task } from '../types/task';

@Provider({ name: 'task-store', scope: ProviderScope.GLOBAL })
export class TaskStoreProvider {
  constructor(private readonly redis: RedisClient) {}

  async create(input: Omit<Task, 'id' | 'createdAt'>): Promise<Task> {
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

// AsyncProvider factory: builds the TaskStoreProvider singleton with a connected Redis client.
// Tools still inject the class itself: `this.get(TaskStoreProvider)`.
export const createTaskStoreProvider = AsyncProvider({
  provide: TaskStoreProvider,
  name: 'task-store-factory',
  scope: ProviderScope.GLOBAL,
  inject: () => [] as const,
  useFactory: async () => {
    const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
    return new TaskStoreProvider(redis);
  },
});
```

```typescript
// src/tasks.app.ts
import { App } from '@frontmcp/sdk';

import { createTaskStoreProvider, TaskStoreProvider } from './providers/task-store.provider';
import { CreateTaskTool } from './tools/create-task.tool';
import { DeleteTaskTool } from './tools/delete-task.tool';
import { ListTasksTool } from './tools/list-tasks.tool';
import { UpdateTaskTool } from './tools/update-task.tool';

@App({
  name: 'Tasks',
  description: 'Task management with CRUD operations',
  // Register the class as the token, plus the factory that produces the singleton.
  providers: [TaskStoreProvider, createTaskStoreProvider],
  tools: [CreateTaskTool, ListTasksTool, UpdateTaskTool, DeleteTaskTool],
})
export class TasksApp {}
```

## What This Demonstrates

- Class-as-token DI: `@Provider({ name, scope })` and inject via `this.get(TaskStoreProvider)`
- Building the singleton with `AsyncProvider({ provide, name, scope, useFactory })` for async setup
- Lifecycle: `onDestroy()` for graceful Redis cleanup on shutdown
- Using `@frontmcp/utils` for `randomUUID()` instead of `node:crypto`
- Per-user data isolation using Redis hash keys (`tasks:${userId}`)

## Related

- See `example-task-manager` for the full task manager example with auth and E2E tests
