---
name: 17-tool-with-concurrency-and-timeout
level: advanced
description: 'Tool with `concurrency` + `timeout` for a real bottleneck (PDF rendering) — caps simultaneous in-flight work AND hard-caps per-call duration.'
tags: [throttling, concurrency, timeout]
features:
  - 'Capping simultaneous in-flight executions with `concurrency: { maxConcurrent }` (server-wide by default)'
  - "Hard-bounding any single call with `timeout: { executeMs }` so a wedged invocation can't hold a concurrency slot indefinitely"
  - 'Giving long child work its own deadline, since `timeout` bounds `execute()` but does not pass an abort signal into it'
  - 'Combining `rateLimit` + `concurrency` + `timeout` as a production triple'
---

# Tool With Concurrency And Timeout

Tool with `concurrency` + `timeout` for a real bottleneck (PDF rendering) — caps simultaneous in-flight work AND hard-caps per-call duration.

For tools that hold a real bottleneck (CPU / GPU / DB write connection), `concurrency` caps simultaneous in-flight executions. Pair with `timeout` so a stuck call can't permanently block a slot.

## Code

```typescript
// src/apps/main/tools/render-pdf.tool.ts
import { Tool, ToolContext, z } from '@frontmcp/sdk';

const inputSchema = {
  template: z.enum(['invoice', 'report', 'contract']),
  data: z.record(z.string(), z.unknown()),
};
const outputSchema = { data: z.string(), mimeType: z.literal('application/pdf'), byteCount: z.number().int() };

@Tool({
  name: 'render_pdf',
  description: 'Render a PDF from a template + data — capped at 5 concurrent renders',
  inputSchema,
  outputSchema,
  rateLimit: { maxRequests: 100, windowMs: 60_000 }, // outer cap — burst protection
  concurrency: { maxConcurrent: 5 }, // inner cap — at most 5 PDFs at once
  timeout: { executeMs: 30_000 }, // hard per-call deadline
  annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false },
})
export class RenderPdfTool extends ToolContext {
  async execute(input: { template: 'invoice' | 'report' | 'contract'; data: Record<string, unknown> }) {
    // Pass a per-render deadline straight into the renderer. `timeout` caps the
    // overall execute() duration at the framework level, but it does NOT hand
    // execute() an abort signal — so bound long child work explicitly here.
    const pdfBuffer = await this.renderPdf(input.template, input.data, { deadlineMs: 25_000 });

    return {
      data: pdfBuffer.toString('base64'),
      mimeType: 'application/pdf' as const,
      byteCount: pdfBuffer.byteLength,
    };
  }

  private async renderPdf(
    _template: string,
    _data: Record<string, unknown>,
    options: { deadlineMs: number },
  ): Promise<Buffer> {
    // pretend this is puppeteer / wkhtmltopdf / a Rust binary that honors its own deadline
    return new Promise((resolve, reject) => {
      const done = setTimeout(() => resolve(Buffer.from('%PDF-1.4 …')), 1_000);
      const deadline = setTimeout(() => {
        clearTimeout(done);
        reject(new Error('render exceeded deadline'));
      }, options.deadlineMs);
      // ensure the deadline timer is cleared once the render resolves
      void Promise.resolve().then(() => clearTimeout(deadline));
    });
  }
}
```

## What This Demonstrates

- Capping simultaneous in-flight executions with `concurrency: { maxConcurrent }` (server-wide by default)
- Hard-bounding any single call with `timeout: { executeMs }` so a wedged invocation can't hold a concurrency slot indefinitely
- Giving long child work its own deadline, since `timeout` bounds `execute()` but does not pass an abort signal into it
- Combining `rateLimit` + `concurrency` + `timeout` as a production triple

## How they interact

Per call, in order:

1. `rateLimit` → reject early if over limit (no concurrency slot consumed)
2. `concurrency` → queue until a slot opens (queue depth is unbounded by default)
3. `timeout` → wraps `execute()` once it actually runs; on expiry, throws `ExecutionTimeoutError` (from `@frontmcp/guard`) and aborts the wrapped execution internally

The three controls are **orthogonal** — each addresses a different failure mode:

| Control       | Protects against                               |
| ------------- | ---------------------------------------------- |
| `rateLimit`   | Quota / billing overrun                        |
| `concurrency` | Resource exhaustion (CPU, GPU, DB connections) |
| `timeout`     | Stuck calls holding slots forever              |

## Why a child-level deadline matters

`timeout` aborts the wrapped `execute()` at the framework level and throws `ExecutionTimeoutError`, but it does **not** pass an abort signal into your code — there is no `this.context.abortSignal`. So if the underlying PDF renderer has no deadline of its own, it keeps going after the timeout fires, burning CPU even though the call already errored out to the client. Give long child work its own bound (as `deadlineMs` does above) so the renderer can clean up and free the concurrency slot for the next queued call.
