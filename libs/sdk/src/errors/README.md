# FrontMCP Error System

Production-ready error handling for MCP servers with type-safe errors, automatic formatting, and security-conscious error exposure.

## Quick Start

```typescript
import { ToolNotFoundError, InvalidInputError, ToolExecutionError, formatMcpErrorResponse } from '@frontmcp/sdk/errors';

// Throw specific errors in your tools
throw new ToolNotFoundError('my-tool');
throw new InvalidInputError('Missing required field: name');

// Format any error for MCP response
const response = formatMcpErrorResponse(error);
```

## Error Hierarchy

```
McpError (abstract base)
├── PublicMcpError (safe to expose to clients)
│   ├── ToolNotFoundError
│   ├── ResourceNotFoundError
│   ├── InvalidResourceUriError
│   ├── InvalidInputError
│   ├── InvalidMethodError
│   ├── RateLimitError
│   ├── QuotaExceededError
│   ├── UnauthorizedError
│   ├── SessionMissingError
│   ├── UnsupportedClientVersionError
│   ├── AuthConfigurationError
│   ├── GlobalConfigNotFoundError
│   ├── PromptNotFoundError
│   ├── AuthorizationRequiredError
│   └── Agent errors (AgentNotFoundError, AgentLoopExceededError, etc.)
│
└── InternalMcpError (hidden from clients in production)
    ├── InvalidOutputError
    ├── ToolExecutionError
    ├── ResourceReadError
    ├── PromptExecutionError
    ├── GenericServerError
    ├── DependencyNotFoundError
    ├── InvalidHookFlowError
    ├── InvalidPluginScopeError
    ├── RequestContextNotAvailableError
    └── Agent errors (AgentExecutionError, AgentLlmError, etc.)
```

## Error Categories

### Tool Errors

| Error                | Type     | Code | Description           |
| -------------------- | -------- | ---- | --------------------- |
| `ToolNotFoundError`  | Public   | 404  | Tool does not exist   |
| `ToolExecutionError` | Internal | 500  | Tool execution failed |

### Resource Errors

| Error                     | Type     | Code | Description                 |
| ------------------------- | -------- | ---- | --------------------------- |
| `ResourceNotFoundError`   | Public   | 404  | Resource does not exist     |
| `ResourceReadError`       | Internal | 500  | Failed to read resource     |
| `InvalidResourceUriError` | Public   | 400  | Invalid resource URI format |

### Validation Errors

| Error                | Type     | Code | Description              |
| -------------------- | -------- | ---- | ------------------------ |
| `InvalidInputError`  | Public   | 400  | Input validation failed  |
| `InvalidOutputError` | Internal | 500  | Output validation failed |
| `InvalidMethodError` | Public   | 400  | Invalid method called    |

### Auth & Session Errors

| Error                           | Type   | Code | Description                  |
| ------------------------------- | ------ | ---- | ---------------------------- |
| `UnauthorizedError`             | Public | 401  | Not authenticated            |
| `SessionMissingError`           | Public | 401  | No valid session             |
| `UnsupportedClientVersionError` | Public | 400  | Client version not supported |
| `AuthorizationRequiredError`    | Public | 403  | App authorization required   |
| `AuthConfigurationError`        | Public | 500  | Auth misconfiguration        |

### Rate Limiting

| Error                | Type   | Code | Description         |
| -------------------- | ------ | ---- | ------------------- |
| `RateLimitError`     | Public | 429  | Rate limit exceeded |
| `QuotaExceededError` | Public | 429  | Quota exceeded      |

### Prompt Errors

| Error                  | Type     | Code | Description             |
| ---------------------- | -------- | ---- | ----------------------- |
| `PromptNotFoundError`  | Public   | 404  | Prompt does not exist   |
| `PromptExecutionError` | Internal | 500  | Prompt execution failed |

### Agent Errors

| Error                     | Type     | Code | Description                   |
| ------------------------- | -------- | ---- | ----------------------------- |
| `AgentNotFoundError`      | Public   | 404  | Agent does not exist          |
| `AgentLoopExceededError`  | Public   | 400  | Max iterations exceeded       |
| `AgentTimeoutError`       | Public   | 408  | Agent timed out               |
| `AgentVisibilityError`    | Public   | 403  | No visibility to target agent |
| `AgentConfigurationError` | Public   | 500  | Invalid agent configuration   |
| `AgentExecutionError`     | Internal | 500  | Agent execution failed        |
| `AgentLlmError`           | Internal | 500  | LLM adapter failed            |
| `AgentNotConfiguredError` | Internal | 500  | No LLM adapter configured     |
| `AgentToolNotFoundError`  | Internal | 500  | Tool not in agent scope       |

### Configuration Errors

| Error                             | Type     | Code | Description                |
| --------------------------------- | -------- | ---- | -------------------------- |
| `GlobalConfigNotFoundError`       | Public   | 500  | Missing global config      |
| `DependencyNotFoundError`         | Internal | 500  | Missing dependency         |
| `InvalidHookFlowError`            | Internal | 500  | Invalid hook configuration |
| `InvalidPluginScopeError`         | Internal | 500  | Invalid plugin scope       |
| `RequestContextNotAvailableError` | Internal | 500  | No request context         |

## Public vs Internal Errors

### Public Errors (`PublicMcpError`)

- **Safe to expose** to end users
- Message is shown as-is in both development and production
- Use for validation errors, not-found errors, auth errors

```typescript
throw new ToolNotFoundError('my-tool');
// User sees: Tool "my-tool" not found
```

### Internal Errors (`InternalMcpError`)

- **Hidden from users** in production
- Full message shown only in development
- Production shows: "Internal FrontMCP error. Please contact support with error ID: err_xxx"

```typescript
throw new ToolExecutionError('my-tool', dbError);
// Dev: Tool "my-tool" execution failed: Connection refused
// Prod: Internal FrontMCP error. Please contact support with error ID: err_a1b2c3d4
```

## Error Response Format

All errors are formatted as MCP-compliant responses:

```typescript
{
  content: [{ type: 'text', text: 'Error message' }],
  isError: true,
  _meta: {
    errorId: 'err_a1b2c3d4e5f6g7h8',
    code: 'TOOL_NOT_FOUND',
    timestamp: '2025-01-04T10:30:00.000Z',
    stack: '...' // Only in development
  }
}
```

## Error Tracking

Every error has a unique `errorId` for correlation:

```typescript
const error = new ToolExecutionError('my-tool', cause);
console.log(error.errorId); // err_a1b2c3d4e5f6g7h8

// Log with context
logger.error('Tool failed', {
  errorId: error.errorId,
  userId: user.id,
  toolName: 'my-tool',
});
```

## JSON-RPC Error Codes

For MCP protocol compliance, use standard JSON-RPC error codes:

```typescript
import { MCP_ERROR_CODES } from '@frontmcp/sdk/errors';

MCP_ERROR_CODES.RESOURCE_NOT_FOUND; // -32002
MCP_ERROR_CODES.INVALID_REQUEST; // -32600
MCP_ERROR_CODES.METHOD_NOT_FOUND; // -32601
MCP_ERROR_CODES.INVALID_PARAMS; // -32602
MCP_ERROR_CODES.INTERNAL_ERROR; // -32603
MCP_ERROR_CODES.PARSE_ERROR; // -32700
```

## Usage Examples

### In Tools

```typescript
import { ToolContext, Tool } from '@frontmcp/sdk';
import { InvalidInputError } from '@frontmcp/sdk/errors';

@Tool({ name: 'create-user' })
class CreateUserTool {
  async execute(ctx: ToolContext<{ name: string }>) {
    const { name } = ctx.input;

    if (!name || name.length < 2) {
      throw new InvalidInputError('Name must be at least 2 characters');
    }

    return { userId: '123', name };
  }
}
```

### In Resources

```typescript
import { ResourceContext, Resource } from '@frontmcp/sdk';
import { ResourceNotFoundError } from '@frontmcp/sdk/errors';

@Resource({ uri: 'file:///{path}' })
class FileResource {
  async read(ctx: ResourceContext<{ path: string }>) {
    const file = await this.findFile(ctx.params.path);

    if (!file) {
      throw new ResourceNotFoundError(`file:///${ctx.params.path}`);
    }

    return { contents: file.data };
  }
}
```

### In Flows

```typescript
import { Flow, Stage } from '@frontmcp/sdk';
import { ToolNotFoundError, ToolExecutionError } from '@frontmcp/sdk/errors';

class CallToolFlow extends Flow {
  @Stage('findTool')
  async findTool() {
    const tool = this.registry.find(this.state.toolName);
    if (!tool) {
      throw new ToolNotFoundError(this.state.toolName);
    }
    this.state.set('tool', tool);
  }

  @Stage('execute')
  async execute() {
    try {
      return await this.state.tool.execute(this.state.input);
    } catch (error) {
      throw new ToolExecutionError(this.state.toolName, error instanceof Error ? error : undefined);
    }
  }
}
```

### In Handlers

```typescript
import { formatMcpErrorResponse } from '@frontmcp/sdk/errors';

async function handleRequest(request) {
  try {
    return await processRequest(request);
  } catch (error) {
    return formatMcpErrorResponse(error);
  }
}
```

## Creating Custom Errors

```typescript
import { PublicMcpError, InternalMcpError } from '@frontmcp/sdk/errors';

// Public error - shown to users
export class PaymentRequiredError extends PublicMcpError {
  constructor(feature: string) {
    super(`Payment required to access: ${feature}`, 'PAYMENT_REQUIRED', 402);
  }
}

// Internal error - hidden in production
export class ExternalApiError extends InternalMcpError {
  constructor(service: string, cause?: Error) {
    super(`${service} API failed: ${cause?.message}`, 'EXTERNAL_API_ERROR');
  }
}
```

## Error Handler Utility

For centralized error handling with logging:

```typescript
import { createErrorHandler } from '@frontmcp/sdk/errors';

const errorHandler = createErrorHandler({
  isDevelopment: process.env.NODE_ENV !== 'production',
  logger: {
    error: (msg, meta) => console.error(msg, meta),
    warn: (msg, meta) => console.warn(msg, meta),
  },
});

// Use in handlers
const response = errorHandler.handle(error, {
  flowName: 'tools:call-tool',
  toolName: 'my-tool',
});
```

## Environment Configuration

```bash
# Development - includes stack traces
NODE_ENV=development

# Production - safe error messages only
NODE_ENV=production
```

## Best Practices

1. **Use specific error types** - Don't throw generic `Error`
2. **Public vs Internal** - Choose based on what users should see
3. **Include context** - Pass original errors for debugging
4. **Use error IDs** - Log with `errorId` for correlation
5. **Validate early** - Throw `InvalidInputError` before processing
6. **Wrap external errors** - Convert third-party errors to MCP errors

## Files

| File                              | Description                                |
| --------------------------------- | ------------------------------------------ |
| `mcp.error.ts`                    | Base classes and all error definitions     |
| `agent.errors.ts`                 | Agent-specific error classes               |
| `authorization-required.error.ts` | Progressive auth error with elicit support |
| `error-handler.ts`                | Error handler utility class                |
| `index.ts`                        | Barrel exports                             |
