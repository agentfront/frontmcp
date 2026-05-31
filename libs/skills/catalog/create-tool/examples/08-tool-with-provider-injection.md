---
name: 08-tool-with-provider-injection
level: intermediate
description: 'Tool that resolves a DI-registered service via `this.get(TOKEN)` and uses it to power `execute()` — the standard pattern for tools that talk to a database or external API.'
tags: [di, provider, this.get, error-handling]
features:
  - "Defining a typed DI token with `Symbol('UserService')` and `Token<UserService>`"
  - 'Implementing a `@Provider` and registering it in the same `@App` as the tool'
  - 'Resolving the service inside `execute()` via `this.get(USER_SERVICE)` (throws when missing)'
  - 'Translating "not found" into `ResourceNotFoundError` via `this.fail(...)` so the client gets a proper MCP error code (-32002)'
---

# Tool With Provider Injection

Tool that resolves a DI-registered service via `this.get(TOKEN)` and uses it to power `execute()` — the standard pattern for tools that talk to a database or external API.

The canonical pattern. A service lives behind a typed token, gets registered as a `@Provider` in the same `@App`, and the tool resolves it via `this.get(TOKEN)`.

## Code

```typescript
// src/apps/main/tokens.ts
import type { Token } from '@frontmcp/di';

export interface UserService {
  findById(id: string): Promise<{ id: string; name: string; email: string } | null>;
}
export const USER_SERVICE: Token<UserService> = Symbol('UserService');
```

```typescript
// src/apps/main/providers/user-service.provider.ts
import { Provider } from '@frontmcp/sdk';

import { USER_SERVICE, type UserService } from '../tokens';

@Provider({ provide: USER_SERVICE })
export class UserServiceProvider implements UserService {
  async findById(id: string) {
    // pretend this hits a database
    if (id === 'u_1') return { id: 'u_1', name: 'Ada', email: 'ada@example.com' };
    return null;
  }
}
```

```typescript
// src/apps/main/tools/get-user.schema.ts
import { ToolInputOf, ToolOutputOf, z } from '@frontmcp/sdk';

export const inputSchema = { id: z.string().describe('User ID') };
export const outputSchema = { id: z.string(), name: z.string(), email: z.string().email() };

export type GetUserInput = ToolInputOf<{ inputSchema: typeof inputSchema }>;
export type GetUserOutput = ToolOutputOf<{ outputSchema: typeof outputSchema }>;
```

```typescript
// src/apps/main/tools/get-user.tool.ts
import { ResourceNotFoundError, Tool, ToolContext } from '@frontmcp/sdk';

import { USER_SERVICE } from '../tokens';
import { inputSchema, outputSchema, type GetUserInput, type GetUserOutput } from './get-user.schema';

@Tool({
  name: 'get_user',
  description: 'Get a user by ID',
  inputSchema,
  outputSchema,
})
export class GetUserTool extends ToolContext {
  async execute(input: GetUserInput): Promise<GetUserOutput> {
    const users = this.get(USER_SERVICE); // throws DependencyNotFoundError if not registered
    const user = await users.findById(input.id);
    if (!user) {
      this.fail(new ResourceNotFoundError(`user:${input.id}`)); // never returns
    }
    return user; // typed as non-null because this.fail is `never`
  }
}
```

```typescript
// src/apps/main/index.ts
import { App } from '@frontmcp/sdk';

import { UserServiceProvider } from './providers/user-service.provider';
import { GetUserTool } from './tools/get-user.tool';

@App({
  name: 'main',
  providers: [UserServiceProvider],
  tools: [GetUserTool],
})
export class MainApp {}
```

> **Testing.** Tests for tools with DI use `@frontmcp/testing`'s `TestServer` with the provider replaced for the test scope. The full pattern (including the canonical `test({ mcp })` fixture and `mcpMatchers`) lives in the dedicated `testing` skill.

## What This Demonstrates

- Defining a typed DI token with `Symbol('UserService')` and `Token<UserService>`
- Implementing a `@Provider` and registering it in the same `@App` as the tool
- Resolving the service inside `execute()` via `this.get(USER_SERVICE)` (throws when missing)
- Translating "not found" into `ResourceNotFoundError` via `this.fail(...)` so the client gets a proper MCP error code (-32002)

## `this.get` vs `this.tryGet`

- `this.get(TOKEN)` — throws `DependencyNotFoundError` if not registered. Use when the tool genuinely requires the dep.
- `this.tryGet(TOKEN)` — returns `undefined` if not registered. Use when the tool degrades gracefully (e.g. optional cache).
