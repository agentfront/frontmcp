---
name: security-and-performance
reference: production-browser
level: advanced
description: 'Shows how to ensure no secrets are bundled in browser code, configure CSP headers on the server, optimize bundle size, and avoid blocking the main thread.'
tags: [production, auth, browser, security, performance]
features:
  - 'No secrets (API keys, tokens) in the browser bundle -- using server-side proxy'
  - 'CORS configured on the server to accept specific browser origins'
  - 'Code splitting with dynamic `import()` for large optional features'
  - 'Yielding to the event loop during large data processing to avoid blocking the main thread'
  - 'Auth tokens obtained from the auth flow, never hardcoded'
---

# Browser SDK Security and Performance Optimization

Shows how to ensure no secrets are bundled in browser code, configure CSP headers on the server, optimize bundle size, and avoid blocking the main thread.

## Code

```typescript
// src/main.ts — Server-side: configure CORS and CSP for browser clients
import { FrontMcp } from '@frontmcp/sdk';
import { MyApp } from './my.app';

@FrontMcp({
  info: { name: 'browser-api', version: '1.0.0' },
  apps: [MyApp],

  // CORS configured for browser origins
  cors: {
    origin: ['https://app.example.com', 'https://admin.example.com'],
    credentials: true,
    maxAge: 86400,
  },

  // API keys stay server-side — browser clients use session tokens
  auth: {
    mode: 'remote',
    provider: 'https://auth.example.com',
    clientId: process.env.AUTH_CLIENT_ID!,
  },
})
export default class BrowserApiServer {}
```

```typescript
// src/browser-sdk/index.ts — Browser SDK entry point
// No secrets in this code — it ships to the browser!

export async function createClient(config: { baseUrl: string; token: string }) {
  // Token comes from the auth flow, not hardcoded
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${config.token}`,
  };

  return {
    async callTool(name: string, args: Record<string, unknown>) {
      const response = await fetch(`${config.baseUrl}/mcp`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'tools/call',
          params: { name, arguments: args },
          id: crypto.randomUUID(),
        }),
      });
      return response.json();
    },

    async listTools() {
      const response = await fetch(`${config.baseUrl}/mcp`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'tools/list',
          id: crypto.randomUUID(),
        }),
      });
      return response.json();
    },
  };
}
```

```typescript
// src/browser-sdk/lazy-features.ts — Code splitting for large optional features

// Lazy-load heavy features — don't include in the main bundle
export async function loadVectorSearch() {
  const { TFIDFVectoria } = await import('vectoriadb');
  return new TFIDFVectoria({ defaultTopK: 10 });
}

// Use in a non-blocking way
export async function processLargeDataset(data: string[]): Promise<string[]> {
  // Don't block the main thread — yield periodically
  const results: string[] = [];
  const BATCH_SIZE = 100;

  for (let i = 0; i < data.length; i += BATCH_SIZE) {
    const batch = data.slice(i, i + BATCH_SIZE);
    results.push(...batch.map((item) => item.toUpperCase()));

    // Yield to the event loop between batches
    if (i + BATCH_SIZE < data.length) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  return results;
}
```

## What This Demonstrates

- No secrets (API keys, tokens) in the browser bundle -- using server-side proxy
- CORS configured on the server to accept specific browser origins
- Code splitting with dynamic `import()` for large optional features
- Yielding to the event loop during large data processing to avoid blocking the main thread
- Auth tokens obtained from the auth flow, never hardcoded

## Related

- See `production-browser` for the full security, distribution, and performance checklist
