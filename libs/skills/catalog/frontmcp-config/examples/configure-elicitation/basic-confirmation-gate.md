---
name: basic-confirmation-gate
reference: configure-elicitation
level: basic
description: 'Request user confirmation before executing a destructive action.'
tags: [config, elicitation, confirmation, gate]
features:
  - 'Enabling elicitation with `elicitation: { enabled: true }` in the `@FrontMcp` decorator'
  - 'Using `this.elicit()` to pause tool execution and request user confirmation'
  - 'Handling the case where the client does not support elicitation (`!confirmation`)'
  - 'Using a boolean `requestedSchema` for simple yes/no confirmations'
---

# Basic Confirmation Gate

Request user confirmation before executing a destructive action.

## Code

```typescript
// src/server.ts
import { App, FrontMcp, Tool, ToolContext, z } from '@frontmcp/sdk';

@Tool({
  name: 'delete_records',
  description: 'Delete records from the database',
  inputSchema: {
    table: z.string(),
    filter: z.string(),
  },
  outputSchema: { deleted: z.number() },
})
class DeleteRecordsTool extends ToolContext {
  async execute(input: { table: string; filter: string }) {
    const count = 42; // simulate counting matching records

    const confirmation = await this.elicit({
      message: `This will delete ${count} records from ${input.table}. Are you sure?`,
      requestedSchema: {
        type: 'object',
        properties: {
          confirmed: { type: 'boolean', description: 'Confirm deletion' },
        },
        required: ['confirmed'],
      },
    });

    if (!confirmation || !confirmation.confirmed) {
      return { deleted: 0 };
    }

    return { deleted: count };
  }
}

@App({
  name: 'db-tools',
  tools: [DeleteRecordsTool],
})
class DbApp {}

@FrontMcp({
  info: { name: 'elicit-server', version: '1.0.0' },
  apps: [DbApp],
  elicitation: {
    enabled: true,
  },
})
class Server {}
```

## What This Demonstrates

- Enabling elicitation with `elicitation: { enabled: true }` in the `@FrontMcp` decorator
- Using `this.elicit()` to pause tool execution and request user confirmation
- Handling the case where the client does not support elicitation (`!confirmation`)
- Using a boolean `requestedSchema` for simple yes/no confirmations

## Related

- See `configure-elicitation` for the full elicitation configuration reference
- See `setup-redis` for distributed elicitation state
