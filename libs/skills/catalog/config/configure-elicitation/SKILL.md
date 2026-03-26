---
name: configure-elicitation
description: Enable interactive user input requests from tools during execution. Use when tools need to ask the user for confirmation, choices, or additional data mid-execution.
tags: [elicitation, user-input, interactive, confirmation, form]
examples:
  - scenario: Tool asks user for confirmation before destructive action
    expected-outcome: Execution pauses, user confirms, tool proceeds
  - scenario: Tool presents a form for user to fill in
    expected-outcome: User fills form fields, tool receives structured input
priority: 6
visibility: both
license: Apache-2.0
metadata:
  docs: https://docs.agentfront.dev/frontmcp/servers/elicitation
---

# Configuring Elicitation

Elicitation allows tools to request interactive input from users mid-execution — confirmations, choices, or structured form data.

## When to Use

Enable elicitation when:

- Tools need user confirmation before destructive actions (delete, deploy, overwrite)
- Tools need additional input during execution (file selection, parameter choice)
- Building multi-step workflows that require user decisions at each stage

## Enable Elicitation

### Basic (In-Memory)

```typescript
@FrontMcp({
  info: { name: 'my-server', version: '1.0.0' },
  apps: [MyApp],
  elicitation: {
    enabled: true,
  },
})
class Server {}
```

### With Redis (Distributed/Production)

```typescript
@FrontMcp({
  info: { name: 'my-server', version: '1.0.0' },
  apps: [MyApp],
  elicitation: {
    enabled: true,
    redis: { provider: 'redis', host: 'localhost', port: 6379 },
  },
})
class Server {}
```

## ElicitationOptionsInput

```typescript
interface ElicitationOptionsInput {
  enabled?: boolean; // default: false
  redis?: RedisOptionsInput; // storage for elicitation state
}
```

## Using Elicitation in Tools

When elicitation is enabled, tools can request user input via the MCP elicitation protocol:

```typescript
import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

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
    // Count records that would be deleted
    const db = this.get(DB_TOKEN);
    const count = await db.count(input.table, input.filter);

    // Request confirmation from user before proceeding
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

    const deleted = await db.delete(input.table, input.filter);
    return { deleted };
  }
}
```

## How It Works

1. Tool calls `this.elicit()` with a message and requested schema
2. Server sends an `elicitation/request` to the client
3. Client displays the request to the user (UI varies by client)
4. User responds with structured data matching the schema
5. `this.elicit()` returns the user's response
6. Tool continues execution with the response

## Notes

- When `enabled: false` (default), `this.elicit()` is not available — keeps resource overhead low
- When enabled, tool output schemas are automatically extended with elicitation fallback type
- Use Redis storage for production/multi-instance deployments
- Not all MCP clients support elicitation — handle gracefully when `this.elicit()` returns `undefined`

## Verification

```bash
# Enable elicitation and start
frontmcp dev

# Test with an MCP client that supports elicitation
# The tool should pause and request user input
```
