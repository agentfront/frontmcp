# FrontMCP Error Handling System

A production-ready error handling system for MCP tools and flows.

## Overview

This error handling system provides:

- **Type-safe error classes** for different error scenarios
- **Public vs Internal errors** - control what users see
- **Development vs Production modes** - detailed errors in dev, safe errors in prod
- **Error IDs** - unique identifiers for tracking errors in logs
- **Automatic error formatting** - consistent MCP-compliant error responses
- **Stack traces** - included in development, excluded in production

## Architecture

### Error Classes

```
McpError (abstract)
├── PublicMcpError (safe to expose to clients)
│   ├── ToolNotFoundError
│   ├── InvalidInputError
│   ├── InvalidMethodError
│   ├── RateLimitError
│   ├── QuotaExceededError
│   └── UnauthorizedError
│
└── InternalMcpError (hidden from clients)
    ├── InvalidOutputError
    ├── ToolExecutionError
    └── GenericServerError
```

## Usage

### 1. In Flow Stages

```typescript
import {
  ToolNotFoundError,
  InvalidInputError,
  InvalidOutputError,
  ToolExecutionError,
} from '../../errors/mcp.error';

class MyFlow extends Flow {
  @Stage('findTool')
  async findTool() {
    const { name } = this.state.required.input;
    const tool = this.findToolByName(name);

    if (!tool) {
      // Public error - user will see: Tool "xyz" not found
      throw new ToolNotFoundError(name);
    }

    this.state.set('tool', tool);
  }

  @Stage('validateInput')
  async validateInput() {
    try {
      const validated = schema.parse(input);
    } catch (err) {
      if (err instanceof z.ZodError) {
        // Public error with validation details
        throw new InvalidInputError('Invalid tool input', err.errors);
      }
      throw err;
    }
  }

  @Stage('execute')
  async execute() {
    try {
      const result = await this.state.toolContext.execute(input);
    } catch (error) {
      // Internal error - user will see:
      // "Internal FrontMCP error. Please contact support with error ID: err_abc123"
      throw new ToolExecutionError(
        this.state.tool.name,
        error instanceof Error ? error : undefined
      );
    }
  }

  @Stage('validateOutput')
  async validateOutput() {
    const parseResult = tool.safeParseOutput(rawOutput);

    if (!parseResult.success) {
      // Internal error - hides schema details
      // User sees: "Output validation failed. Please contact support with error ID: err_xyz789"
      throw new InvalidOutputError();
    }
  }
}
```

### 2. In MCP Handlers

```typescript
import { formatMcpErrorResponse } from '../errors/mcp.error';

export default function callToolRequestHandler({ scope }: McpHandlerOptions) {
  const isDevelopment = process.env.NODE_ENV !== 'production';

  return {
    requestSchema: CallToolRequestSchema,
    handler: async (request: CallToolRequest, ctx): Promise<CallToolResult> => {
      try {
        const result = await scope.runFlowForOutput('tools:call-tool', {
          request,
          ctx,
        });
        return result;
      } catch (e) {
        // Automatically formats error based on environment
        return formatMcpErrorResponse(e, isDevelopment);
      }
    },
  };
}
```

### 3. Creating Custom Error Classes

```typescript
import { PublicMcpError, InternalMcpError } from './mcp.error';

// Public error - safe to show users
export class CustomValidationError extends PublicMcpError {
  constructor(field: string, reason: string) {
    super(`Validation failed for field "${field}": ${reason}`, 'CUSTOM_VALIDATION_ERROR', 400);
  }
}

// Internal error - hidden from users
export class DatabaseConnectionError extends InternalMcpError {
  constructor(dbName: string, originalError?: Error) {
    super(`Failed to connect to database "${dbName}": ${originalError?.message}`, 'DB_CONNECTION_ERROR');
  }
}
```

## Error Response Format

### Development Mode

```json
{
  "content": [
    {
      "type": "text",
      "text": "Tool \"non_existent_tool\" not found"
    }
  ],
  "isError": true,
  "_meta": {
    "errorId": "err_a1b2c3d4e5f6g7h8",
    "code": "TOOL_NOT_FOUND",
    "timestamp": "2025-11-18T10:30:00.000Z",
    "stack": "Error: Tool \"non_existent_tool\" not found\n    at CallToolFlow.findTool ..."
  }
}
```

### Production Mode

```json
{
  "content": [
    {
      "type": "text",
      "text": "Tool \"non_existent_tool\" not found"
    }
  ],
  "isError": true,
  "_meta": {
    "errorId": "err_a1b2c3d4e5f6g7h8",
    "code": "TOOL_NOT_FOUND",
    "timestamp": "2025-11-18T10:30:00.000Z"
  }
}
```

### Internal Error in Production

```json
{
  "content": [
    {
      "type": "text",
      "text": "Internal FrontMCP error. Please contact support with error ID: err_a1b2c3d4e5f6g7h8"
    }
  ],
  "isError": true,
  "_meta": {
    "errorId": "err_a1b2c3d4e5f6g7h8",
    "code": "TOOL_EXECUTION_ERROR",
    "timestamp": "2025-11-18T10:30:00.000Z"
  }
}
```

## Error Logging

All errors are logged with appropriate context:

```typescript
// Public errors (warnings)
logger.warn('Public error: Tool "xyz" not found', {
  errorId: 'err_abc123',
  code: 'TOOL_NOT_FOUND',
  flowName: 'tools:call-tool',
  toolName: 'xyz',
});

// Internal errors (errors)
logger.error('Internal error: Tool execution failed', {
  errorId: 'err_xyz789',
  code: 'TOOL_EXECUTION_ERROR',
  flowName: 'tools:call-tool',
  toolName: 'my_tool',
  stack: '...', // only in development
});
```

## Best Practices

### 1. Use Specific Error Types

```typescript
// ❌ Bad - generic error
throw new Error('Something went wrong');

// ✅ Good - specific error type
throw new ToolNotFoundError(toolName);
```

### 2. Distinguish Public vs Internal Errors

```typescript
// ❌ Bad - exposing internal details
throw new Error(`Database query failed: ${dbError.message}`);

// ✅ Good - hiding internal details
throw new ToolExecutionError(toolName, dbError);
```

### 3. Include Context in Error IDs

```typescript
// The error ID is automatically generated
const error = new InvalidInputError('Missing required field');
console.log(error.errorId); // err_a1b2c3d4e5f6g7h8

// Use this ID in logs for correlation
logger.error('Error details', {
  errorId: error.errorId,
  userId: user.id,
  toolName: tool.name,
});
```

### 4. Handle Validation Errors Properly

```typescript
try {
  const validated = schema.parse(input);
} catch (err) {
  if (err instanceof z.ZodError) {
    // Include validation details for the user
    throw new InvalidInputError('Invalid input', err.errors);
  }
  throw err;
}
```

### 5. Wrap Execution Errors

```typescript
try {
  await externalService.call();
} catch (error) {
  // Wrap external errors to control the message
  throw new ToolExecutionError(toolName, error instanceof Error ? error : undefined);
}
```

## Environment Configuration

Set the `NODE_ENV` environment variable:

```bash
# Development - includes stack traces and detailed errors
NODE_ENV=development

# Production - safe error messages, no stack traces
NODE_ENV=production
```

## Migration Guide

### Updating Existing Flows

1. Import error classes:

```typescript
import { ToolNotFoundError, InvalidInputError, InvalidOutputError, ToolExecutionError } from '../../errors/mcp.error';
```

2. Replace generic errors:

```typescript
// Before
throw new Error('Tool not found');

// After
throw new ToolNotFoundError(toolName);
```

3. Update validation error handling:

```typescript
// Before
catch (err) {
  this.fail(new Error('Invalid input'));
}

// After
catch (err) {
  if (err instanceof z.ZodError) {
    throw new InvalidInputError('Invalid input', err.errors);
  }
  throw err;
}
```

4. Wrap execution errors:

```typescript
// Before
catch (error) {
  throw error;
}

// After
catch (error) {
  throw new ToolExecutionError(toolName, error instanceof Error ? error : undefined);
}
```

### Updating Handlers

```typescript
// Before
catch (e) {
  throw e;
}

// After
import { formatMcpErrorResponse } from '../errors/mcp.error';

catch (e) {
  return formatMcpErrorResponse(e, isDevelopment);
}
```

## Testing

### Testing Error Responses

```typescript
import { ToolNotFoundError } from '../errors/mcp.error';

describe('Error Handling', () => {
  it('should format public error correctly in production', () => {
    const error = new ToolNotFoundError('my_tool');
    const response = error.toMcpError(false); // production mode

    expect(response.isError).toBe(true);
    expect(response.content[0].text).toBe('Tool "my_tool" not found');
    expect(response._meta?.errorId).toMatch(/^err_/);
    expect(response._meta?.stack).toBeUndefined();
  });

  it('should include stack trace in development', () => {
    const error = new ToolNotFoundError('my_tool');
    const response = error.toMcpError(true); // development mode

    expect(response._meta?.stack).toBeDefined();
  });

  it('should hide internal error details in production', () => {
    const error = new ToolExecutionError('my_tool', new Error('DB connection failed'));
    const response = error.toMcpError(false); // production mode

    expect(response.content[0].text).toMatch(/Internal FrontMCP error/);
    expect(response.content[0].text).toMatch(/err_/);
    expect(response.content[0].text).not.toMatch(/DB connection/);
  });
});
```

## Monitoring and Alerting

Use error IDs and codes for monitoring:

```typescript
// In your logging/monitoring system
logger.error('Tool execution failed', {
  errorId: error.errorId,
  errorCode: error.code,
  userId: context.userId,
  toolName: tool.name,
  environment: process.env.NODE_ENV,
  timestamp: new Date().toISOString(),
});

// Alert on internal errors
if (!error.isPublic) {
  alerting.sendAlert({
    severity: 'high',
    message: `Internal error: ${error.code}`,
    errorId: error.errorId,
  });
}
```

## Troubleshooting

### Error ID not showing in logs

Make sure you're logging the error properly:

```typescript
catch (error) {
  if (error instanceof McpError) {
    logger.error('Error occurred', {
      errorId: error.errorId,
      code: error.code
    });
  }
}
```

### Stack traces in production

Check your `NODE_ENV`:

```bash
echo $NODE_ENV  # should be "production"
```

### Generic error messages

Make sure you're using the correct error class:

```typescript
// ❌ This will show as generic internal error
throw new Error('Tool not found');

// ✅ This will show the specific message
throw new ToolNotFoundError(toolName);
```
