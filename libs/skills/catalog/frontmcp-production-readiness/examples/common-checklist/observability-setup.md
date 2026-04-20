---
name: observability-setup
reference: common-checklist
level: intermediate
description: 'Shows how to configure structured logging, error handling with MCP error codes, and monitoring integration for production.'
tags: [production, observability, checklist, setup]
features:
  - 'Using `this.mark()` to annotate execution phases for tracing'
  - 'Using `this.fail()` for business-logic errors without exposing internals'
  - 'Setting timeouts on all external calls via `AbortSignal.timeout()`'
  - 'Implementing health check providers that verify downstream dependencies'
---

# Observability and Error Handling Setup

Shows how to configure structured logging, error handling with MCP error codes, and monitoring integration for production.

## Code

```typescript
// src/tools/monitored-tool.tool.ts
import { Tool, ToolContext, z } from '@frontmcp/sdk';

@Tool({
  name: 'monitored_operation',
  description: 'A tool with proper error handling and observability markers',
  inputSchema: {
    operationId: z.string().min(1).describe('Operation identifier'),
  },
  outputSchema: {
    status: z.string(),
    operationId: z.string(),
  },
})
export class MonitoredOperationTool extends ToolContext {
  async execute(input: { operationId: string }) {
    // Mark execution phases for tracing and duration metrics
    this.mark('validation');
    // ... validate business rules ...

    this.mark('processing');
    const result = await this.processOperation(input.operationId);

    if (!result) {
      // Use this.fail() with specific errors — never expose stack traces
      this.fail(new Error(`Operation not found: ${input.operationId}`));
    }

    // Report progress for long-running operations
    await this.respondProgress(1, 1);

    return { status: 'completed', operationId: input.operationId };
  }

  private async processOperation(id: string): Promise<boolean> {
    // External call with timeout — always set timeouts for external services
    const response = await this.fetch(`https://api.example.com/operations/${id}`, {
      signal: AbortSignal.timeout(5000), // 5 second timeout
    });
    return response.ok;
  }
}
```

```typescript
// src/providers/health-check.provider.ts
import { Provider, ProviderScope } from '@frontmcp/sdk';

export const HEALTH_CHECK = Symbol('HealthCheck');

@Provider({ token: HEALTH_CHECK, scope: ProviderScope.GLOBAL })
export class HealthCheckProvider {
  async checkRedis(): Promise<boolean> {
    // Verify downstream dependency is reachable
    try {
      // ... ping Redis ...
      return true;
    } catch {
      return false;
    }
  }

  async checkDatabase(): Promise<boolean> {
    try {
      // ... run a lightweight query ...
      return true;
    } catch {
      return false;
    }
  }
}
```

## What This Demonstrates

- Using `this.mark()` to annotate execution phases for tracing
- Using `this.fail()` for business-logic errors without exposing internals
- Setting timeouts on all external calls via `AbortSignal.timeout()`
- Implementing health check providers that verify downstream dependencies

## Related

- See `common-checklist` for the full observability and monitoring checklist
