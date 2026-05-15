---
name: tool-with-di-and-errors
reference: create-tool
level: intermediate
description: 'A tool that resolves a database service via DI and uses `this.fail()` for business-logic errors, with `execute()` types derived from the schemas.'
tags: [development, database, tool, di, errors]
features:
  - 'Defining a typed DI token with `Token<T>` and resolving it via `this.get()`'
  - 'Using `this.fail()` with `ResourceNotFoundError` for MCP-compliant error responses'
  - 'Letting infrastructure errors (database failures) propagate naturally to the framework'
  - 'Deriving `execute()` types from `inputSchema` / `outputSchema` via `ToolInputOf<>` / `ToolOutputOf<>`'
  - 'Folder-per-tool layout (`tools/delete-record/{schema,tool,index}.ts`) for tools with local helpers or error types'
  - 'Registering both the provider and tool in the same `@App`'
---

# Tool with Dependency Injection and Error Handling

A tool that resolves a database service via DI and uses `this.fail()` for business-logic errors, with `execute()` types derived from the schemas.

## File layout

```
src/apps/main/
├── tokens.ts                              # shared DI tokens
└── tools/
    └── delete-record/
        ├── delete-record.schema.ts        # input/output schemas + derived types
        ├── delete-record.tool.ts          # @Tool class, execute()
        └── index.ts                       # barrel re-export
```

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
// src/apps/main/tools/delete-record/delete-record.schema.ts
import { ToolInputOf, ToolOutputOf, z } from '@frontmcp/sdk';

// Only the schemas live here — decorator config (`name`, `description`, …)
// stays inside @Tool({…}) in the tool file.
export const inputSchema = {
  id: z.string().uuid().describe('Record UUID'),
};

export const outputSchema = {
  message: z.string(),
};

export type DeleteRecordInput = ToolInputOf<{ inputSchema: typeof inputSchema }>;
export type DeleteRecordOutput = ToolOutputOf<{ outputSchema: typeof outputSchema }>;
```

```typescript
// src/apps/main/tools/delete-record/delete-record.tool.ts
import { ResourceNotFoundError, Tool, ToolContext } from '@frontmcp/sdk';

import { DATABASE } from '../../tokens';
import { inputSchema, outputSchema, type DeleteRecordInput, type DeleteRecordOutput } from './delete-record.schema';

@Tool({
  name: 'delete_record',
  description: 'Delete a record by ID',
  inputSchema,
  outputSchema,
})
export class DeleteRecordTool extends ToolContext {
  async execute(input: DeleteRecordInput): Promise<DeleteRecordOutput> {
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
// src/apps/main/tools/delete-record/index.ts
export { DeleteRecordTool } from './delete-record.tool';
export {
  inputSchema as deleteRecordInputSchema,
  outputSchema as deleteRecordOutputSchema,
  type DeleteRecordInput,
  type DeleteRecordOutput,
} from './delete-record.schema';
```

```typescript
// src/apps/main/index.ts
import { App } from '@frontmcp/sdk';

import { DeleteRecordTool } from './tools/delete-record';

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
- Deriving `execute()` types from `inputSchema` / `outputSchema` via `ToolInputOf<>` / `ToolOutputOf<>`
- Folder-per-tool layout (`tools/delete-record/{schema,tool,index}.ts`) for tools with local helpers or error types
- Registering both the provider and tool in the same `@App`

## Related

- See `create-tool` for all context methods, the derive-types pattern, and error handling
- See `create-provider` for how to implement the `DatabaseProvider` class
