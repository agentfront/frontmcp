---
name: find-a-blocking-tool
reference: stall-detection
level: basic
description: 'Turn on stall detection and see the warning name a tool that blocks the event loop.'
tags: [observability, stalls, event-loop, metrics]
features:
  - 'Setting `observability: { stalls: { thresholdMs } }` on `@FrontMcp`'
  - 'Reading the `Event loop stalled for` warning that names the call in flight'
  - 'Scraping `frontmcp_event_loop_stall_seconds_total` per entry from `/metrics`'
---

# Find a tool that blocks the event loop

Turn on stall detection and see the warning name a tool that blocks the event loop.

## Code

```typescript
// src/main.ts
import { App, FrontMcp, Tool, ToolContext, z } from '@frontmcp/sdk';

@Tool({
  name: 'checksum',
  description: 'Hashes a payload many times, synchronously',
  inputSchema: { rounds: z.number().int().min(1) },
})
class ChecksumTool extends ToolContext {
  async execute(input: { rounds: number }): Promise<string> {
    let value = 0;
    for (let round = 0; round < input.rounds * 1_000_000; round++) value = (value * 31 + round) | 0;
    return String(value);
  }
}

@App({ id: 'reports', name: 'Reports', tools: [ChecksumTool] })
class ReportsApp {}

@FrontMcp({
  info: { name: 'my-server', version: '1.0.0' },
  apps: [ReportsApp],
  metrics: { enabled: true },
  observability: { tracing: false, stalls: { thresholdMs: 200 } },
})
export default class Server {}
```

```bash
# Call `checksum` with { "rounds": 500 } from your MCP client, then:
[CallMonitor] Event loop stalled for 812 ms while running tools/call reports:checksum (809 ms, session 3fa9c2d41b07)

$ curl -s http://localhost:3000/metrics | grep stall
# TYPE frontmcp_event_loop_stall_seconds_total counter
frontmcp_event_loop_stall_seconds_total{cause="tools/call",entry="reports:checksum"} 0.812
```

## What This Demonstrates

- Setting `observability: { stalls: { thresholdMs } }` on `@FrontMcp`
- Reading the `Event loop stalled for` warning that names the call in flight
- Scraping `frontmcp_event_loop_stall_seconds_total` per entry from `/metrics`

## Related

- See `stall-detection` for GC pauses, the dev events file and how calls are tracked
- See `metrics-endpoint` for the `/metrics` endpoint
