# Elicitation Support

This module provides MCP elicitation support for requesting interactive user input from clients during tool or agent execution. It supports both the standard MCP elicitation protocol (for clients like Claude) and an automatic fallback mechanism for clients that don't support elicitation (like OpenAI, Gemini, etc.).

## Overview

Elicitation allows tools and agents to pause execution and request structured input from the user. This is useful for:

- **Confirmation dialogs**: "Are you sure you want to delete this file?"
- **Multi-step wizards**: Collecting complex data in stages
- **User preferences**: Asking for configuration options
- **Authorization flows**: Requesting user consent before sensitive operations

## Quick Start

### Basic Usage in Tools

```typescript
import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

const inputSchema = {
  action: z.string(),
};

@Tool({
  name: 'delete-file',
  description: 'Delete a file with user confirmation',
  inputSchema,
})
class DeleteFileTool extends ToolContext<typeof inputSchema> {
  async execute(input: { action: string }) {
    // Request user confirmation before deleting
    const result = await this.elicit(
      `Are you sure you want to delete "${input.action}"?`,
      z.object({
        confirmed: z.boolean().describe('Confirm deletion'),
      }),
    );

    if (result.status === 'accept' && result.content?.confirmed) {
      // User confirmed, proceed with deletion
      return { text: `File "${input.action}" has been deleted.` };
    }

    // User cancelled or declined
    return { text: 'Deletion was cancelled by user.' };
  }
}
```

### Elicitation Result Handling

The `elicit()` method returns an `ElicitResult<T>` with:

- `status`: One of `'accept'`, `'cancel'`, or `'decline'`
- `content`: The typed user response (only present when status is `'accept'`)

```typescript
const result = await this.elicit(message, schema, options);

switch (result.status) {
  case 'accept':
    // User provided input: result.content contains the validated data
    console.log('User input:', result.content);
    break;
  case 'cancel':
    // User cancelled the operation
    break;
  case 'decline':
    // User declined to provide information
    break;
}
```

### Elicitation Options

```typescript
await this.elicit(message, schema, {
  mode: 'form', // 'form' (default) or 'url'
  ttl: 300000, // Timeout in ms (default: 5 minutes)
  elicitationId: '...', // Custom ID for URL mode tracking
});
```

## How It Works

### Standard Elicitation (Claude, etc.)

For MCP clients that support the elicitation protocol:

```
┌──────────┐  elicit()   ┌───────────┐  elicitation/create  ┌────────┐
│   Tool   │ ──────────► │ Transport │ ──────────────────► │ Client │
│          │ ◄────────── │           │ ◄────────────────── │  (UI)  │
└──────────┘   result    └───────────┘  elicitation/result  └────────┘
```

1. Tool calls `this.elicit(message, schema)`
2. FrontMCP sends `elicitation/create` request to the client
3. Client displays UI to the user
4. User responds, client sends `elicitation/result`
5. Tool receives the typed result and continues

### Fallback Elicitation (OpenAI, Gemini, etc.)

For clients that don't support the standard protocol, FrontMCP automatically falls back to an LLM-mediated approach:

```
┌──────────┐  elicit()   ┌───────────────────┐  instructions   ┌─────┐
│   Tool   │ ──────────► │ throws Fallback   │ ──────────────► │ LLM │
│          │             │ Error (caught)    │                 │     │
└──────────┘             └───────────────────┘                 └──┬──┘
                                                                  │
┌──────────────────────────────────────────────────────────────────┘
│  LLM asks user, then calls sendElicitationResult tool
▼
┌───────────────────────┐  re-invoke tool   ┌──────────┐
│ sendElicitationResult │ ────────────────► │   Tool   │
│   (with result)       │ ◄──────────────── │ (runs)   │
└───────────────────────┘   tool's result   └──────────┘
```

1. Tool calls `this.elicit(message, schema)`
2. Client doesn't support elicitation - `ElicitationFallbackRequired` is thrown
3. Framework catches the error and returns structured instructions to the LLM
4. LLM asks the user and collects input
5. LLM calls `sendElicitationResult` tool with the user's response
6. Original tool is re-invoked with the result pre-injected
7. Tool's `elicit()` returns immediately with the resolved result

**Key benefit**: Tool code is identical for both flows - no code changes needed!

## Fallback Response Format

When fallback is triggered, the tool returns a structured response:

```json
{
  "content": [
    {
      "type": "text",
      "text": "This tool requires user input to continue.\n\n**Question:** Are you sure?\n\n..."
    }
  ],
  "_meta": {
    "elicitationPending": {
      "elicitId": "elicit-1234-abc",
      "message": "Are you sure?",
      "schema": { "type": "object", "properties": { ... } },
      "instructions": "Call sendElicitationResult tool after collecting user input"
    }
  }
}
```

The LLM then calls `sendElicitationResult`:

```json
{
  "name": "sendElicitationResult",
  "arguments": {
    "elicitId": "elicit-1234-abc",
    "action": "accept",
    "content": { "confirmed": true }
  }
}
```

## Multi-Step Wizards

You can chain multiple elicitations for complex workflows:

```typescript
@Tool({ name: 'multi-step-wizard', inputSchema, description: '...' })
class MultiStepWizardTool extends ToolContext<typeof inputSchema> {
  async execute(input: { topic: string }) {
    // Step 1: Get basic info
    const step1 = await this.elicit('Step 1: Enter your name', z.object({ name: z.string() }));

    if (step1.status !== 'accept') {
      return { text: 'Wizard cancelled at step 1' };
    }

    // Step 2: Get preferences
    const step2 = await this.elicit(
      `Hi ${step1.content.name}! Step 2: Choose your preferences`,
      z.object({
        color: z.enum(['red', 'green', 'blue']),
        notifications: z.boolean(),
      }),
    );

    if (step2.status !== 'accept') {
      return { text: 'Wizard cancelled at step 2' };
    }

    // Complete with all collected data
    return {
      text: `Welcome ${step1.content.name}! Your favorite color is ${step2.content.color}.`,
    };
  }
}
```

## Distributed Deployments

For distributed deployments (multiple server instances), use Redis to store elicitation state:

```typescript
import { FrontMcp } from '@frontmcp/sdk';

@FrontMcp({
  id: 'my-server',
  redis: {
    host: 'localhost',
    port: 6379,
  },
})
class MyServer {}
```

This automatically uses `RedisElicitationStore` instead of the default `InMemoryElicitationStore`.

## Store Implementations

### InMemoryElicitationStore

- Default for development and single-node deployments
- Stores elicitation state in memory
- Fast but not suitable for distributed deployments

### RedisElicitationStore

- For distributed/multi-node production deployments
- Stores elicitation state in Redis with automatic TTL
- Required for serverless or multi-instance deployments

## API Reference

### `elicit<S>(message, schema, options?): Promise<ElicitResult<S>>`

Request user input during tool/agent execution.

**Parameters:**

- `message: string` - The prompt displayed to the user
- `schema: ZodType<S>` - Zod schema defining the expected response structure
- `options?: ElicitOptions` - Optional configuration

**Returns:** `Promise<ElicitResult<S>>` with status and typed content

### `ElicitResult<T>`

```typescript
interface ElicitResult<T = unknown> {
  status: 'accept' | 'cancel' | 'decline';
  content?: T; // Only present when status is 'accept'
}
```

### `ElicitOptions`

```typescript
interface ElicitOptions {
  mode?: 'form' | 'url'; // Default: 'form'
  ttl?: number; // Default: 300000 (5 minutes)
  elicitationId?: string; // For URL mode tracking
}
```

## Client Compatibility

| Client         | Elicitation Support | Mechanism                                   |
| -------------- | ------------------- | ------------------------------------------- |
| Claude Desktop | ✅ Native           | Standard MCP protocol                       |
| Claude.ai      | ✅ Native           | Standard MCP protocol                       |
| OpenAI ChatGPT | ✅ Fallback         | sendElicitationResult tool                  |
| Google Gemini  | ✅ Fallback         | sendElicitationResult tool                  |
| Cursor         | ✅ Fallback         | sendElicitationResult tool                  |
| Custom Clients | Depends             | Check `experimental.elicitation` capability |

## Error Handling

### ElicitationNotSupportedError

Thrown when elicitation is not possible (e.g., no transport available):

```typescript
try {
  await this.elicit(message, schema);
} catch (error) {
  if (error instanceof ElicitationNotSupportedError) {
    // Handle gracefully - provide default or skip
  }
}
```

### ElicitationTimeoutError

Thrown when the user doesn't respond within the TTL:

```typescript
const result = await this.elicit(message, schema, { ttl: 60000 }); // 1 minute
// If timeout, ElicitationTimeoutError is thrown
```

## Programmatic Access via DirectClient

DirectClient supports elicitation handling for programmatic MCP access:

```typescript
import { connect } from '@frontmcp/sdk/direct';
import type { ElicitationHandler, ElicitationRequest, ElicitationResponse } from '@frontmcp/sdk/direct';

const client = await connect(scope);

// Register elicitation handler
const handler: ElicitationHandler = async (request: ElicitationRequest) => {
  // Display UI or prompt user
  const userInput = await promptUser(request.message, request.requestedSchema);

  return {
    action: 'accept',
    content: userInput,
  };
};

const unsubscribe = client.onElicitation(handler);

// Call a tool that uses elicitation
const result = await client.callTool('delete-file', { action: 'important.txt' });

// Clean up
unsubscribe();
```

If no handler is registered, elicitation requests are automatically declined.

See [DirectClient README](../direct/README.md) for complete API documentation.

## Best Practices

1. **Keep schemas simple**: Use clear, minimal schemas for better UX
2. **Provide helpful messages**: Include context in your elicit messages
3. **Handle all statuses**: Always handle cancel/decline gracefully
4. **Set appropriate TTLs**: Longer for complex forms, shorter for confirmations
5. **Use descriptions**: Add `.describe()` to Zod fields for better UI hints

```typescript
z.object({
  email: z.string().email().describe('Your email address'),
  subscribe: z.boolean().describe('Receive newsletter updates'),
});
```

## Files

- `elicitation.types.ts` - Type definitions and interfaces
- `elicitation.store.ts` - Abstract store interface
- `memory-elicitation.store.ts` - In-memory store implementation
- `redis-elicitation.store.ts` - Redis store implementation
- `send-elicitation-result.tool.ts` - System tool for fallback flow
- `index.ts` - Module exports
