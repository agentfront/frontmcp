---
name: quick-start
description: 60-second tour — minimal tool, schemas, registration, calling it.
---

# Quick start

Goal: a working tool in five files (schema, tool, app, server, spec) in 60 seconds.

## 1. The schemas (single source of truth)

```typescript
// src/apps/main/tools/greet-user.schema.ts
import { ToolInputOf, ToolOutputOf, z } from '@frontmcp/sdk';

export const inputSchema = {
  name: z.string().describe('The name of the user to greet'),
};

export const outputSchema = {
  greeting: z.string(),
};

export type GreetUserInput = ToolInputOf<{ inputSchema: typeof inputSchema }>;
export type GreetUserOutput = ToolOutputOf<{ outputSchema: typeof outputSchema }>;
```

## 2. The tool

```typescript
// src/apps/main/tools/greet-user.tool.ts
import { Tool, ToolContext } from '@frontmcp/sdk';

import { inputSchema, outputSchema, type GreetUserInput, type GreetUserOutput } from './greet-user.schema';

@Tool({
  name: 'greet_user',
  description: 'Greet a user by name',
  inputSchema,
  outputSchema,
})
export class GreetUserTool extends ToolContext {
  async execute(input: GreetUserInput): Promise<GreetUserOutput> {
    return { greeting: `Hello, ${input.name}!` };
  }
}
```

## 3. The app

```typescript
// src/apps/main/index.ts
import { App } from '@frontmcp/sdk';

import { GreetUserTool } from './tools/greet-user.tool';

@App({
  name: 'main',
  tools: [GreetUserTool],
})
export class MainApp {}
```

## 4. The server

```typescript
// src/main.ts
import { FrontMcp } from '@frontmcp/sdk';

import { MainApp } from './apps/main';

@FrontMcp({
  info: { name: 'demo', version: '1.0.0' },
  apps: [MainApp],
})
export default class DemoServer {}
```

## 5. The test

```typescript
// src/apps/main/tools/greet-user.tool.spec.ts
import { testTool } from '@frontmcp/testing';

import { GreetUserTool } from './greet-user.tool';

describe('GreetUserTool', () => {
  it('greets the user', async () => {
    const result = await testTool(GreetUserTool).call({ name: 'Ada' });
    expect(result).toEqual({ greeting: 'Hello, Ada!' });
  });
});
```

## Run it

```bash
yarn dev     # starts the server
yarn test    # runs the spec
```

## What you just did

- Hoisted the **schemas** to their own file (so specs / generated clients can reuse them).
- Derived `execute()`'s **input/output types** from the schemas via `ToolInputOf<>` / `ToolOutputOf<>`. The schema is the single source of truth — change a Zod field and the type follows.
- Used a **raw Zod shape** for `inputSchema` (not `z.object({...})`) — the framework wraps it internally.
- Always defined an **`outputSchema`**. Without it, any field your code accidentally returns leaks to the client.
- Registered the tool in an **`@App({ tools })`**, not directly on `@FrontMcp` — apps own modularity and per-app lifecycle / auth.
- Wrote a **`.tool.spec.ts`** unit test using `@frontmcp/testing` — happy-path coverage from day one.

## What's next

- Add a real implementation → read [`execution-context.md`](./execution-context.md) for `this.get`, `this.fetch`, `this.notify`.
- Return structured / media / multi-content output → [`output-schema.md`](./output-schema.md).
- Make it interactive with a UI widget → [`ui-widgets.md`](./ui-widgets.md).
- Pick an example matching your scenario from [`SKILL.md` § Scenario routing table](../SKILL.md#scenario-routing-table).
