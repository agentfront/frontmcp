---
name: tool-with-rate-limiting-and-progress
reference: create-tool
level: advanced
description: 'A batch processing tool that uses rate limiting, concurrency control, progress notifications, and annotations.'
tags: [development, throttle, tool, rate, limiting, progress]
features:
  - 'Configuring `rateLimit`, `concurrency`, and `timeout` for throttling protection'
  - 'Sending progress updates to the client with `this.respondProgress(value, total)`'
  - 'Using `this.mark(stage)` for execution stage tracking and debugging'
  - 'Sending log-level notifications with `this.notify(message, level)`'
  - 'Setting tool `annotations` to communicate behavioral hints to clients'
---

# Tool with Rate Limiting, Progress, and Annotations

A batch processing tool that uses rate limiting, concurrency control, progress notifications, and annotations.

## Code

```typescript
// src/apps/main/tools/batch-process.tool.ts
import { Tool, ToolContext, z } from '@frontmcp/sdk';

@Tool({
  name: 'batch_process',
  description: 'Process a batch of items with progress tracking',
  inputSchema: {
    items: z.array(z.string()).min(1).describe('Items to process'),
  },
  outputSchema: {
    processed: z.number(),
    results: z.array(z.string()),
  },
  annotations: {
    title: 'Batch Processor',
    readOnlyHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  rateLimit: { maxRequests: 10, windowMs: 60_000 },
  concurrency: { maxConcurrent: 2 },
  timeout: { executeMs: 30_000 },
})
class BatchProcessTool extends ToolContext {
  async execute(input: { items: string[] }): Promise<{ processed: number; results: string[] }> {
    this.mark('validation');
    if (input.items.some((item) => item.trim() === '')) {
      this.fail(new Error('Items must not be empty strings'));
    }

    this.mark('processing');
    const results: string[] = [];
    for (let i = 0; i < input.items.length; i++) {
      await this.respondProgress(i + 1, input.items.length);
      const result = await this.processItem(input.items[i]);
      results.push(result);
    }

    this.mark('complete');
    await this.notify(`Processed ${results.length} items`, 'info');
    return { processed: results.length, results };
  }

  private async processItem(item: string): Promise<string> {
    return `processed:${item}`;
  }
}
```

```typescript
// src/apps/main/index.ts
import { App } from '@frontmcp/sdk';

@App({
  name: 'main',
  tools: [BatchProcessTool],
})
class MainApp {}
```

## What This Demonstrates

- Configuring `rateLimit`, `concurrency`, and `timeout` for throttling protection
- Sending progress updates to the client with `this.respondProgress(value, total)`
- Using `this.mark(stage)` for execution stage tracking and debugging
- Sending log-level notifications with `this.notify(message, level)`
- Setting tool `annotations` to communicate behavioral hints to clients

## Related

- See `create-tool` for all annotation fields, elicitation, and auth provider patterns
