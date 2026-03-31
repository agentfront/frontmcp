---
name: auth-and-crud-tools
reference: example-task-manager
level: basic
description: 'Shows how to create CRUD tools with authentication, using `this.context.session` for user isolation and `this.get()` for dependency injection.'
tags: [guides, auth, session, task-manager, task, manager]
features:
  - 'Using `this.context.session?.userId` for per-user data isolation'
  - 'Using `this.get(TASK_STORE)` for dependency injection of providers'
  - 'Enforcing authentication with `this.fail()` when no session exists'
  - 'Optional input fields with `.optional()` for filtering'
  - '`outputSchema` with nested `z.array(z.object(...))` for structured responses'
---

# Task Manager: Authenticated CRUD Tools

Shows how to create CRUD tools with authentication, using `this.context.session` for user isolation and `this.get()` for dependency injection.

## Code

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
    // Inject the task store via DI
    const store = this.get(TASK_STORE);

    // Get the authenticated user's ID from the session
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

## What This Demonstrates

- Using `this.context.session?.userId` for per-user data isolation
- Using `this.get(TASK_STORE)` for dependency injection of providers
- Enforcing authentication with `this.fail()` when no session exists
- Optional input fields with `.optional()` for filtering
- `outputSchema` with nested `z.array(z.object(...))` for structured responses

## Related

- See `example-task-manager` for the full task manager example with provider, auth, and tests
