---
name: 16-tool-with-rate-limit
level: intermediate
description: 'Tool with `rateLimit: { maxRequests, windowMs }` capping invocations per session per minute — the protection for expensive / external-API-billed operations.'
tags: [throttling, rate-limit, abuse-protection]
features:
  - "Capping the tool to N invocations per windowMs, partitioned per session via `partitionBy: 'session'`"
  - "Letting the framework reject over-limit calls with `RateLimitError` (code `'RATE_LIMIT_EXCEEDED'`, HTTP status 429) carrying a retry-after hint in its message that clients can back off against"
  - 'Combining `rateLimit` with `annotations.openWorldHint: true` so clients know the tool talks to billed external services'
  - Sizing the limit against upstream quota / billing — not just "what feels reasonable"
---

# Tool With Rate Limit

Tool with `rateLimit: { maxRequests, windowMs }` capping invocations per session per minute — the protection for expensive / external-API-billed operations.

The first throttle to reach for. Caps invocations over time. The default partition is `'global'` (one shared limit); this example sets `partitionBy: 'session'` so a runaway agent loop on one session can't burn through a quota that other sessions need.

## Code

```typescript
// src/apps/main/tools/translate.tool.ts
import { Tool, ToolContext, z } from '@frontmcp/sdk';

const inputSchema = {
  text: z.string().min(1).max(2_000),
  targetLang: z.string().regex(/^[a-z]{2}$/, 'ISO 639-1 code'),
};
const outputSchema = { translated: z.string(), sourceLang: z.string() };

@Tool({
  name: 'translate',
  description: 'Translate text via the external translation API (billed per call)',
  inputSchema,
  outputSchema,
  rateLimit: { maxRequests: 60, windowMs: 60_000, partitionBy: 'session' }, // 60 calls / minute / session
  authProviders: ['translate-api'],
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
})
export class TranslateTool extends ToolContext {
  async execute(input: { text: string; targetLang: string }) {
    const headers = await this.authProviders.headers('translate-api');
    const response = await this.fetch('https://api.translate.example/v1/translate', {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ text: input.text, target: input.targetLang }),
    });
    const data = (await response.json()) as { translated: string; detectedSource: string };
    return { translated: data.translated, sourceLang: data.detectedSource };
  }
}
```

> **Testing.** The framework throws `RateLimitError` (HTTP 429, code `'RATE_LIMIT_EXCEEDED'`) for over-limit calls. Tests that assert the rate-limit fires after N calls live in the dedicated `testing` skill — the canonical pattern uses `@frontmcp/testing`'s `TestServer` + Playwright `test`/`expect` fixtures.

## What This Demonstrates

- Capping the tool to N invocations per windowMs, partitioned per session via `partitionBy: 'session'`
- Letting the framework reject over-limit calls with `RateLimitError` (code `'RATE_LIMIT_EXCEEDED'`, HTTP status 429) carrying a retry-after hint in its message that clients can back off against
- Combining `rateLimit` with `annotations.openWorldHint: true` so clients know the tool talks to billed external services
- Sizing the limit against upstream quota / billing — not just "what feels reasonable"

## Sizing the limit

- **External API quotas** — set well below the upstream quota. If GitHub allows 5,000/hour authenticated, a per-session limit of 30/min (1,800/hr) gives room for multiple sessions to share the budget.
- **Billed services** — lower. A `translate` call may cost $0.02. 60/min × 60min × 24h × 1 session = $1,728/day worst case.
- **Pure rate concern, not cost** — 100/min is generous for almost anything.

## Global vs per-session

The default partition is `'global'` — one limit shared across all callers. For a limit that's tracked independently per session, set `partitionBy: 'session'` (so a runaway loop on one session can't burn through everyone's budget). See the `throttling` reference for the full set of `partitionBy` strategies (`'global' | 'session' | 'userId' | 'ip'` or a custom function).
