---
name: readonly-query-tool
reference: create-tool-annotations
level: basic
description: 'Demonstrates annotating a tool that only reads data, signaling to MCP clients that it has no side effects and is safe to retry.'
tags: [development, database, local, tool, annotations, readonly]
features:
  - 'Setting `readOnlyHint: true` to indicate the tool performs no mutations'
  - 'Setting `destructiveHint: false` to tell clients no data will be deleted or overwritten'
  - 'Setting `idempotentHint: true` because repeated calls with the same input produce the same result'
  - 'Setting `openWorldHint: false` because the tool only accesses local database data'
  - 'Using `title` to provide a human-friendly display name for MCP client UIs'
---

# Read-Only Query Tool with Annotations

Demonstrates annotating a tool that only reads data, signaling to MCP clients that it has no side effects and is safe to retry.

## Code

```typescript
// src/tools/search-users.tool.ts
import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

@Tool({
  name: 'search_users',
  description: 'Search for users by name or email',
  inputSchema: {
    query: z.string().describe('Search query'),
    limit: z.number().optional().default(10),
  },
  annotations: {
    title: 'Search Users',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
})
class SearchUsersTool extends ToolContext {
  async execute(input: { query: string; limit: number }) {
    const db = this.get(DatabaseToken);
    const users = await db.searchUsers(input.query, input.limit);
    return { users };
  }
}
```

## What This Demonstrates

- Setting `readOnlyHint: true` to indicate the tool performs no mutations
- Setting `destructiveHint: false` to tell clients no data will be deleted or overwritten
- Setting `idempotentHint: true` because repeated calls with the same input produce the same result
- Setting `openWorldHint: false` because the tool only accesses local database data
- Using `title` to provide a human-friendly display name for MCP client UIs

## Related

- See `create-tool-annotations` for the full fields reference and default values
