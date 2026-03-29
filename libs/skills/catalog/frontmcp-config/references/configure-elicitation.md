---
name: configure-elicitation
description: Configure interactive user input during tool execution for confirmations, choices, and forms
---

# Configuring Elicitation

Elicitation allows tools to request interactive input from users mid-execution — confirmations, choices, or structured form data.

## When to Use This Skill

### Must Use

- Tools need user confirmation before destructive actions (delete, deploy, overwrite)
- Building interactive multi-step workflows that require user decisions mid-execution
- Tools need structured form input from the user during execution (e.g., parameter selection, file choice)

### Recommended

- Adding a safety gate to tools that modify external systems (databases, APIs, deployments)
- Implementing approval flows where a tool must get explicit consent before proceeding
- Multi-instance production deployments where elicitation state must be shared via Redis

### Skip When

- Tools are fully autonomous and never need user input -- elicitation adds overhead when unused
- The MCP client does not support elicitation -- check client capabilities first (see Notes section)
- Only need input validation, not mid-execution prompts -- use Zod input schemas on the `@Tool` decorator

> **Decision:** Use this skill when tools need to pause execution and request interactive input from the user; skip if all tools run autonomously without user interaction.

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

## Common Patterns

| Pattern                      | Correct                                                                 | Incorrect                                                        | Why                                                                                                              |
| ---------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Handling unsupported clients | Check `if (!confirmation)` after `this.elicit()` and provide a fallback | Assuming `this.elicit()` always returns a value                  | Not all MCP clients support elicitation; `undefined` is returned when the client cannot handle the request       |
| Schema for confirmation      | Use `{ confirmed: { type: 'boolean' } }` in `requestedSchema`           | Using a plain string prompt without a schema                     | Structured schemas let the client render proper UI controls (checkboxes, dropdowns) instead of free-text input   |
| Redis for production         | Set `elicitation: { enabled: true, redis: { provider: 'redis', ... } }` | Using in-memory elicitation state in a multi-instance deployment | In-memory state is per-process; if the response arrives at a different instance, the elicitation context is lost |
| Enabled flag                 | Explicitly set `elicitation: { enabled: true }`                         | Omitting the `enabled` field and expecting elicitation to work   | Elicitation is disabled by default (`enabled: false`) to minimize resource overhead                              |

## Verification Checklist

### Configuration

- [ ] `elicitation.enabled` is set to `true` in the `@FrontMcp` decorator
- [ ] For production/multi-instance: `elicitation.redis` is configured with a valid Redis provider
- [ ] The `requestedSchema` in `this.elicit()` calls uses valid JSON Schema objects

### Runtime

- [ ] Tool execution pauses when `this.elicit()` is called and the client supports elicitation
- [ ] The user sees a prompt or form matching the requested schema
- [ ] After the user responds, `this.elicit()` returns the structured data and the tool resumes
- [ ] When the client does not support elicitation, `this.elicit()` returns `undefined` and the tool handles the fallback gracefully

### Integration

- [ ] MCP client under test advertises elicitation support in its capabilities
- [ ] Destructive tools have elicitation-based confirmation gates before proceeding

## Troubleshooting

| Problem                                           | Cause                                                                       | Solution                                                                                            |
| ------------------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `this.elicit is not a function`                   | Elicitation is not enabled in the server configuration                      | Set `elicitation: { enabled: true }` in the `@FrontMcp` decorator                                   |
| `this.elicit()` returns `undefined` immediately   | The connected MCP client does not support elicitation                       | Check client capabilities; provide a fallback code path for unsupported clients                     |
| Elicitation works locally but fails in production | In-memory store loses state across multiple server instances                | Configure `elicitation.redis` to share elicitation state via Redis                                  |
| User sees raw JSON instead of a form              | The MCP client renders the `requestedSchema` as raw data rather than a form | Use standard JSON Schema types (`boolean`, `string`, `enum`) that clients can render as UI controls |
| Tool hangs indefinitely waiting for user response | No timeout configured and user never responds                               | Implement a timeout or cancellation mechanism in the tool logic to handle non-responsive users      |

## Reference

- [Elicitation Docs](https://docs.agentfront.dev/frontmcp/servers/elicitation)
- Related skills: `configure-http`, `configure-transport`, `setup-redis`, `create-tool`
