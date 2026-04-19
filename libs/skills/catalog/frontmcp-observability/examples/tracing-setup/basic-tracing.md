---
name: basic-tracing
reference: tracing-setup
level: basic
description: 'Enable auto-tracing and see spans printed to your terminal.'
tags: [tracing, setup, console, basic]
features:
  - 'Zero-config tracing via observability: true'
  - 'Console exporter for local development'
  - 'Single trace ID shared across all spans in a request'
---

# Basic Tracing Setup

Enable auto-tracing and see spans printed to your terminal.

## Code

```typescript
// src/setup-otel.ts
import { setupOTel } from '@frontmcp/observability';

// Call BEFORE @FrontMcp runs
setupOTel({ serviceName: 'my-server', exporter: 'console' });
```

```typescript
// src/server.ts
import './setup-otel'; // Must be first import

import { FrontMcp } from '@frontmcp/sdk';

import { MyApp } from './apps/my-app';

@FrontMcp({
  info: { name: 'my-server', version: '1.0.0' },
  apps: [MyApp],
  observability: true,
})
export default class Server {}
```

```typescript
// src/apps/my-app/tools/hello.tool.ts
import { Tool, ToolContext, z } from '@frontmcp/sdk';

@Tool({
  name: 'hello',
  description: 'Say hello',
  inputSchema: { name: z.string() },
})
export class HelloTool extends ToolContext {
  async execute({ name }: { name: string }) {
    return { greeting: `Hello, ${name}!` };
  }
}
```

When you call `hello` via an MCP client, you'll see spans in the console:

```
{
  traceId: 'abcdef1234567890abcdef1234567890',
  name: 'tools/call',
  attributes: { 'rpc.system': 'mcp', 'mcp.method.name': 'tools/call' }
}
{
  traceId: 'abcdef1234567890abcdef1234567890',
  parentId: '...',
  name: 'tool hello',
  attributes: { 'mcp.component.type': 'tool', 'mcp.component.key': 'tool:hello' }
}
```

## What This Demonstrates

- Zero-config tracing via observability: true
- Console exporter for local development
- Single trace ID shared across all spans in a request

## Related

- See `tracing-setup` for OTLP and production configuration
