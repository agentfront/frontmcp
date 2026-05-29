---
name: 18-tool-with-progress-and-notify
level: intermediate
description: "Long-running tool emitting progress updates (`this.progress`), log notifications (`this.notify`), and stage markers (`this.mark`) — the standard pattern for jobs you don't want to feel hung."
tags: [progress, notifications, mark, long-running]
features:
  - 'Emitting per-item progress with `await this.progress(current, total, message)`'
  - 'Sending free-form log notifications at `info` / `warning` / `error` levels with `await this.notify(message, level)`'
  - 'Marking execution stages with `this.mark(stage)` so observability tools have breadcrumbs'
  - "Letting `this.progress(...)` return `false` cheaply when no progress token was provided (zero-cost when nobody's listening)"
---

# Tool With Progress And Notify

Long-running tool emitting progress updates (`this.progress`), log notifications (`this.notify`), and stage markers (`this.mark`) — the standard pattern for jobs you don't want to feel hung.

Anything that takes more than a couple of seconds should emit progress. The framework's notifications API is a single line per emission; clients render progress bars / activity logs / breadcrumb timelines from it.

## Code

```typescript
// src/apps/main/tools/process-items.tool.ts
import { Tool, ToolContext, z } from '@frontmcp/sdk';

const inputSchema = {
  items: z.array(z.string()).min(1).max(1_000),
};
const outputSchema = {
  processed: z.number().int(),
  failed: z.number().int(),
  results: z.array(z.object({ item: z.string(), status: z.enum(['ok', 'failed']) })),
};

@Tool({
  name: 'process_items',
  description: 'Process a batch of items, emitting progress per item',
  inputSchema,
  outputSchema,
  timeout: { executeMs: 5 * 60_000 }, // 5min ceiling
  annotations: { idempotentHint: true, openWorldHint: false },
})
export class ProcessItemsTool extends ToolContext {
  async execute(input: { items: string[] }) {
    this.mark('validation');
    // (Zod already validated; this.mark adds a server-side breadcrumb)

    this.mark('processing');
    const results: { item: string; status: 'ok' | 'failed' }[] = [];

    for (let i = 0; i < input.items.length; i++) {
      const item = input.items[i];
      const ok = await this.processOne(item);
      results.push({ item, status: ok ? 'ok' : 'failed' });

      // Emit progress; cheap no-op if the request didn't send a progress token
      await this.progress(i + 1, input.items.length, `Processed ${item}`);
    }

    const failed = results.filter((r) => r.status === 'failed').length;
    if (failed > 0) {
      await this.notify(`${failed}/${input.items.length} items failed`, 'warning');
    } else {
      await this.notify(`All ${input.items.length} items processed`, 'info');
    }

    this.mark('complete');
    return { processed: results.length, failed, results };
  }

  private async processOne(_item: string): Promise<boolean> {
    return Math.random() > 0.05;
  }
}
```

> **Testing.** Tests that intercept `this.progress` / `this.notify` events live in the dedicated `testing` skill — `@frontmcp/testing` exposes the notification stream via the `TestServer` + Playwright `test`/`expect` fixture surface.

## What This Demonstrates

- Emitting per-item progress with `await this.progress(current, total, message)`
- Sending free-form log notifications at `info` / `warning` / `error` levels with `await this.notify(message, level)`
- Marking execution stages with `this.mark(stage)` so observability tools have breadcrumbs
- Letting `this.progress(...)` return `false` cheaply when no progress token was provided (zero-cost when nobody's listening)

## When to use which

| Use                            | For                                                                        |
| ------------------------------ | -------------------------------------------------------------------------- |
| `this.progress(n, total, msg)` | Quantitative progress — clients render a progress bar                      |
| `this.notify(msg, level?)`     | Qualitative updates — log lines, status, warnings                          |
| `this.mark(stage)`             | Server-side only — surfaced in logs/metrics/traces, not sent to the client |

## Don't

- Don't call `this.progress` in a tight loop with no `total`. Without `total`, clients can't render a meaningful bar.
- Don't push a `this.notify` per loop iteration. That's progress. Use `this.progress` for granular updates and reserve `this.notify` for events the user genuinely needs to see (failures, warnings, milestones).
