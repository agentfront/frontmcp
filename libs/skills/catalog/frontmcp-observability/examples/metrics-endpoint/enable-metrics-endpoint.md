---
name: enable-metrics-endpoint
reference: metrics-endpoint
level: basic
description: 'Turn on the /metrics endpoint with defaults and scrape it with curl.'
tags: [observability, metrics, prometheus]
features:
  - 'Setting `metrics: { enabled: true }` on `@FrontMcp` to register `GET /metrics`'
  - 'Verifying the Prometheus text-exposition response with `curl`'
  - 'Reading process metrics + framework counters from a single scrape'
---

# Enable the /metrics endpoint

Turn on the /metrics endpoint with defaults and scrape it with curl.

## Code

```typescript
// src/main.ts
import { App, FrontMcp, Tool, ToolContext, z } from '@frontmcp/sdk';

@Tool({
  name: 'echo',
  description: 'Echo the input back',
  inputSchema: { message: z.string() },
  outputSchema: { message: z.string() },
})
class EchoTool extends ToolContext {
  async execute(input: { message: string }): Promise<{ message: string }> {
    return { message: input.message };
  }
}

@App({ name: 'main', tools: [EchoTool] })
class MainApp {}

@FrontMcp({
  info: { name: 'my-server', version: '1.0.0' },
  apps: [MainApp],
  // Off by default — turn it on explicitly.
  metrics: { enabled: true },
})
export default class Server {}
```

```bash
# In a terminal:
$ frontmcp dev
[dev] listening on port 3000

# In a second terminal:
$ curl -s http://localhost:3000/metrics | head -20
# HELP frontmcp_process_resident_memory_bytes Resident memory size in bytes
# TYPE frontmcp_process_resident_memory_bytes gauge
frontmcp_process_resident_memory_bytes 50331648
# HELP frontmcp_process_uptime_seconds Time since process start in seconds
# TYPE frontmcp_process_uptime_seconds gauge
frontmcp_process_uptime_seconds 14
# HELP frontmcp_process_cpu_seconds_total CPU time consumed since collector start, by mode (seconds)
# TYPE frontmcp_process_cpu_seconds_total counter
frontmcp_process_cpu_seconds_total{mode="user"} 0.123
frontmcp_process_cpu_seconds_total{mode="system"} 0.045

$ curl -sI http://localhost:3000/metrics | grep -i content-type
content-type: text/plain; version=0.0.4; charset=utf-8
```

## What This Demonstrates

- Setting `metrics: { enabled: true }` on `@FrontMcp` to register `GET /metrics`
- Verifying the Prometheus text-exposition response with `curl`
- Reading process metrics + framework counters from a single scrape

## Related

- See `metrics-endpoint` for full configuration (auth, format, include filter, custom counters via `createCounter()`)
