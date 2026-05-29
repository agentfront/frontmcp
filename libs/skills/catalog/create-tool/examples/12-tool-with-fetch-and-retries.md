---
name: 12-tool-with-fetch-and-retries
level: advanced
description: 'Tool calling a flaky external API with exponential backoff retries, an Idempotency-Key for safety, and respect for `Retry-After` on 429s.'
tags: [fetch, retries, exponential-backoff, idempotency-key, 429-rate-limit]
features:
  - Retrying on transient errors (5xx + 429) with exponential backoff plus jitter
  - "Generating an `Idempotency-Key` so retried POSTs don't duplicate side effects on the upstream"
  - 'Respecting an upstream `Retry-After` header on 429 responses instead of guessing'
  - "Capping the total retry budget with `timeout: { executeMs }` so a wedged upstream can't hang the call indefinitely"
---

# Tool With Fetch And Retries

Tool calling a flaky external API with exponential backoff retries, an Idempotency-Key for safety, and respect for `Retry-After` on 429s.

Real upstreams flake. This shows the pattern that survives them: retry the right errors, back off correctly, generate an idempotency key so retried POSTs don't double-fire, and cap the whole thing with `timeout`.

## Code

```typescript
// src/apps/main/tools/create-issue.tool.ts
import { PublicMcpError, Tool, ToolContext, z } from '@frontmcp/sdk';
import { randomUUID } from '@frontmcp/utils';

const inputSchema = {
  repo: z.string().regex(/^[^\/]+\/[^\/]+$/, 'expected owner/repo'),
  title: z.string().min(1).max(256),
  body: z.string().max(65_536).optional(),
};
const outputSchema = { issueNumber: z.number().int().min(1), url: z.string().url() };

const MAX_ATTEMPTS = 4;
const BASE_DELAY_MS = 200;

@Tool({
  name: 'create_issue',
  description: 'Create a GitHub issue (retries on 5xx / 429)',
  inputSchema,
  outputSchema,
  rateLimit: { maxRequests: 30, windowMs: 60_000 },
  timeout: { executeMs: 30_000 }, // hard cap across all retries
  annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: true },
  authProviders: ['github'],
})
export class CreateIssueTool extends ToolContext {
  async execute(input: { repo: string; title: string; body?: string }) {
    const headers = await this.authProviders.headers('github');
    const idempotencyKey = randomUUID();

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const response = await this.fetch(`https://api.github.com/repos/${input.repo}/issues`, {
        method: 'POST',
        headers: {
          ...headers,
          'content-type': 'application/json',
          'idempotency-key': idempotencyKey,
        },
        body: JSON.stringify({ title: input.title, body: input.body }),
        signal: this.context.abortSignal,
      });

      if (response.ok) {
        const data = (await response.json()) as { number: number; html_url: string };
        return { issueNumber: data.number, url: data.html_url };
      }

      // Non-retryable client errors → fail immediately
      if (response.status >= 400 && response.status < 500 && response.status !== 429) {
        const detail = await response.text();
        this.fail(new PublicMcpError(`GitHub returned ${response.status}: ${detail.slice(0, 200)}`));
      }

      // Retryable (5xx or 429) — back off and try again
      if (attempt === MAX_ATTEMPTS) {
        this.fail(new PublicMcpError(`GitHub upstream failed after ${MAX_ATTEMPTS} attempts`));
      }

      // Retry-After is either a number of seconds ("120") or an HTTP-date — handle both.
      const retryAfter = response.headers.get('retry-after');
      const retryAfterMs = (() => {
        if (!retryAfter) return undefined;
        const seconds = Number(retryAfter);
        if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
        const at = Date.parse(retryAfter);
        return Number.isFinite(at) ? Math.max(0, at - Date.now()) : undefined;
      })();
      const baseDelay = retryAfterMs ?? BASE_DELAY_MS * 2 ** (attempt - 1);
      const jitter = Math.floor(Math.random() * baseDelay * 0.2);
      await this.notify(
        `Attempt ${attempt} returned ${response.status}; retrying in ${baseDelay + jitter}ms`,
        'warning',
      );
      await new Promise((r) => setTimeout(r, baseDelay + jitter));
    }
    /* unreachable — this.fail above never returns */
    this.fail(new PublicMcpError('unreachable'));
  }
}
```

## What This Demonstrates

- Retrying on transient errors (5xx + 429) with exponential backoff plus jitter
- Generating an `Idempotency-Key` so retried POSTs don't duplicate side effects on the upstream
- Respecting an upstream `Retry-After` header on 429 responses instead of guessing
- Capping the total retry budget with `timeout: { executeMs }` so a wedged upstream can't hang the call indefinitely

## Why these choices

- **`Idempotency-Key` is critical for POSTs.** Without it, a retry after a network glitch can create two issues. GitHub honors `Idempotency-Key` server-side; many other APIs (Stripe, etc.) do too.
- **Jitter prevents thundering herds.** All clients retrying at exactly 200ms / 400ms / 800ms create synchronized spikes. ±20% jitter spreads them.
- **`timeout: { executeMs: 30_000 }` is the safety net.** The retry loop alone can take 200 + 400 + 800 = 1.4s just in backoff. With a slow upstream, total time spirals — the tool-level timeout caps it.
- **Don't retry 4xx (except 429).** 4xx means "your request is wrong" — retrying won't help and may double up the upstream's accounting.
