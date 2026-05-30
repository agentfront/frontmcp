---
name: 11-tool-with-fetch
level: intermediate
description: 'Tool calling an external HTTP API with `this.fetch` — context propagation, status-code handling, and bounding the call with a tool `timeout`.'
tags: [fetch, http, external-api, error-handling]
features:
  - 'Using `this.fetch(url, init?)` so trace context propagates to the upstream service'
  - 'Translating non-2xx HTTP responses into `PublicMcpError` so the MCP client gets a clean error'
  - "Bounding the call with a tool `timeout` (and `this.fetch`'s built-in per-request timeout) — without relying on a non-existent context abort signal"
  - "Letting genuine network errors (DNS failure, ECONNREFUSED) propagate to the framework's error flow"
---

# Tool With Fetch

Tool calling an external HTTP API with `this.fetch` — context propagation, status-code handling, and bounding the call with a tool `timeout`.

`this.fetch` is the standard `fetch` plus trace-context propagation. Always use it instead of bare `fetch` so distributed tracing stitches the upstream call into the same trace as the MCP request.

## Code

```typescript
// src/apps/main/tools/get-weather.tool.ts
import { PublicMcpError, ResourceNotFoundError, Tool, ToolContext, z } from '@frontmcp/sdk';

const inputSchema = {
  city: z.string().describe('City name, e.g. "Seattle"'),
  units: z.enum(['celsius', 'fahrenheit']).default('fahrenheit'),
};
const outputSchema = {
  city: z.string(),
  temperature: z.number(),
  conditions: z.string(),
  units: z.enum(['celsius', 'fahrenheit']),
};

@Tool({
  name: 'get_weather',
  description: 'Current weather from api.weather.example',
  inputSchema,
  outputSchema,
  timeout: { executeMs: 10_000 }, // cap the whole call if the upstream hangs
})
export class GetWeatherTool extends ToolContext {
  async execute(input: { city: string; units: 'celsius' | 'fahrenheit' }) {
    const url = new URL('https://api.weather.example/v1/current');
    url.searchParams.set('city', input.city);
    url.searchParams.set('units', input.units);

    const response = await this.fetch(url, {
      headers: { accept: 'application/json' },
      // `this.fetch` applies its own request timeout (default 30s). The tool-level
      // `timeout` below caps the whole execute() at the framework level.
    });

    if (response.status === 404) {
      this.fail(new ResourceNotFoundError(`weather:${input.city}`));
    }
    if (!response.ok) {
      this.fail(new PublicMcpError(`Weather API returned ${response.status} ${response.statusText}`));
    }

    const body = (await response.json()) as { temp: number; summary: string };
    return {
      city: input.city,
      temperature: body.temp,
      conditions: body.summary,
      units: input.units,
    };
  }
}
```

## What This Demonstrates

- Using `this.fetch(url, init?)` so trace context propagates to the upstream service
- Translating non-2xx HTTP responses into `PublicMcpError` so the MCP client gets a clean error
- Bounding the call with a tool `timeout` (and `this.fetch`'s built-in per-request timeout) — without relying on a non-existent context abort signal
- Letting genuine network errors (DNS failure, ECONNREFUSED) propagate to the framework's error flow

## Don't do this

```typescript
// ❌ swallows network errors, hides infrastructure problems from observability
async execute(input) {
  try {
    const response = await this.fetch(url);
    return await response.json();
  } catch (err) {
    return { error: String(err) };
  }
}
```

Let infrastructure errors propagate. The framework wraps them in `InternalError` (`-32603`) for the client and logs them properly for ops. Only convert specific business-level conditions (status codes you know about) to `this.fail`.
