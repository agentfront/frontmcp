---
name: cross-platform-crypto
reference: production-browser
level: intermediate
description: 'Shows how to use `@frontmcp/utils` for cross-platform crypto operations that work in both browser and Node.js, and how to avoid Node.js-only APIs.'
tags: [production, browser, node, cross, platform, crypto]
features:
  - 'Using `@frontmcp/utils` for crypto instead of `node:crypto` (wraps Web Crypto API)'
  - 'Using Fetch API for HTTP calls instead of Node.js `http`/`https`'
  - 'Using `crypto.randomUUID()` from the Web Crypto API in browser code'
  - 'WebSocket connection with automatic reconnection for streaming'
  - 'No Node.js-only APIs (`fs`, `path`, `child_process`, `net`)'
---

# Cross-Platform Crypto and Browser Compatibility

Shows how to use `@frontmcp/utils` for cross-platform crypto operations that work in both browser and Node.js, and how to avoid Node.js-only APIs.

## Code

```typescript
// src/tools/browser-safe-hash.tool.ts
import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';
// @frontmcp/utils wraps Web Crypto API — works in browsers
import { sha256Hex, sha256Base64url, randomUUID } from '@frontmcp/utils';

@Tool({
  name: 'hash_data',
  description: 'Hash data using browser-compatible crypto',
  inputSchema: {
    data: z.string().min(1).describe('Data to hash'),
    format: z.enum(['hex', 'base64url']).default('hex').describe('Output format'),
  },
  outputSchema: {
    hash: z.string(),
    format: z.string(),
    id: z.string(),
  },
})
export class HashDataTool extends ToolContext {
  async execute(input: { data: string; format: 'hex' | 'base64url' }) {
    // Cross-platform: works in browser (Web Crypto) and Node.js
    const hash = input.format === 'hex' ? sha256Hex(input.data) : sha256Base64url(input.data);
    const id = randomUUID();

    return { hash, format: input.format, id };
  }
}
```

```typescript
// src/client/browser-client.ts
// Browser-compatible MCP client — no Node.js APIs

export class BrowserMcpClient {
  private baseUrl: string;

  constructor(config: { baseUrl: string }) {
    this.baseUrl = config.baseUrl;
  }

  // Use Fetch API — not Node.js http/https
  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/call',
        params: { name, arguments: args },
        id: crypto.randomUUID(), // Web Crypto API
      }),
    });

    const result = await response.json();
    return result;
  }

  // WebSocket with reconnection for SSE/streaming
  connectStream(onMessage: (data: unknown) => void): { close: () => void } {
    let ws: WebSocket;
    let reconnectTimer: ReturnType<typeof setTimeout>;

    const connect = () => {
      ws = new WebSocket(this.baseUrl.replace('http', 'ws') + '/mcp/stream');
      ws.onmessage = (event) => onMessage(JSON.parse(event.data));
      ws.onclose = () => {
        // Reconnect gracefully
        reconnectTimer = setTimeout(connect, 1000);
      };
    };

    connect();

    return {
      close: () => {
        clearTimeout(reconnectTimer);
        ws?.close();
      },
    };
  }
}
```

## What This Demonstrates

- Using `@frontmcp/utils` for crypto instead of `node:crypto` (wraps Web Crypto API)
- Using Fetch API for HTTP calls instead of Node.js `http`/`https`
- Using `crypto.randomUUID()` from the Web Crypto API in browser code
- WebSocket connection with automatic reconnection for streaming
- No Node.js-only APIs (`fs`, `path`, `child_process`, `net`)

## Related

- See `production-browser` for the full browser compatibility and security checklist
