---
name: tool-with-di-and-errors
reference: create-tool
level: intermediate
description: 'A tool that resolves a database service via DI and uses `this.fail()` for business-logic errors.'
tags: [development, database, tool, di, errors]
features:
  - 'Defining a typed DI token with `Token<T>` and resolving it via `this.get()`'
  - 'Using `this.fail()` with `ResourceNotFoundError` for MCP-compliant error responses'
  - 'Letting infrastructure errors (database failures) propagate naturally to the framework'
  - 'Registering both the provider and tool in the same `@App`'
---

# Tool with Dependency Injection and Error Handling

A tool that resolves a database service via DI and uses `this.fail()` for business-logic errors.

## Code

```typescript
// src/apps/main/tokens.ts
import type { Token } from '@frontmcp/di';

export interface DatabaseService {
  query(sql: string, params: unknown[]): Promise<unknown[]>;
}

export const DATABASE: Token<DatabaseService> = Symbol('database');
```

```typescript
// src/apps/main/tools/delete-record.tool.ts
import { ResourceNotFoundError, Tool, ToolContext, z } from '@frontmcp/sdk';

import { DATABASE } from '../tokens';

@Tool({
  name: 'delete_record',
  description: 'Delete a record by ID',
  inputSchema: {
    id: z.string().uuid().describe('Record UUID'),
  },
  outputSchema: {
    message: z.string(),
  },
})
class DeleteRecordTool extends ToolContext {
  async execute(input: { id: string }): Promise<{ message: string }> {
    const db = this.get(DATABASE);
    const rows = await db.query('SELECT * FROM records WHERE id = $1', [input.id]);

    if (rows.length === 0) {
      this.fail(new ResourceNotFoundError(`Record ${input.id}`));
    }

    await db.query('DELETE FROM records WHERE id = $1', [input.id]);
    return { message: `Record ${input.id} deleted successfully` };
  }
}
```

```typescript
// src/apps/main/index.ts
import { App } from '@frontmcp/sdk';

@App({
  name: 'main',
  providers: [DatabaseProvider],
  tools: [DeleteRecordTool],
})
class MainApp {}
```

## What This Demonstrates

- Defining a typed DI token with `Token<T>` and resolving it via `this.get()`
- Using `this.fail()` with `ResourceNotFoundError` for MCP-compliant error responses
- Letting infrastructure errors (database failures) propagate naturally to the framework
- Registering both the provider and tool in the same `@App`

## Related

- See `create-tool` for all context methods and error handling patterns
- See `create-provider` for how to implement the `DatabaseProvider` class
