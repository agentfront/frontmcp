---
name: browser-crypto-and-storage
reference: build-for-browser
level: advanced
description: 'Use `@frontmcp/utils` crypto functions (WebCrypto API) and a `DirectMcpServer` in browser environments.'
tags: [deployment, browser, crypto, react]
features:
  - 'Using `@frontmcp/utils` for PKCE and hashing in the browser (backed by WebCrypto, not `node:crypto`)'
  - 'Creating a `DirectMcpServer` with `create()` and passing it to `FrontMcpProvider` via `server={...}`'
  - 'Using `useListTools` for the tools list (the real hook name)'
---

# Browser-Safe Crypto and Storage

Use `@frontmcp/utils` crypto in the browser, and create the FrontMCP server with `create()` from `@frontmcp/sdk` so the React provider can consume it via the `server` prop.

## Code

```typescript
// src/browser-auth.ts
import { generateCodeChallenge, generateCodeVerifier, randomUUID, sha256Base64url } from '@frontmcp/utils';

// PKCE flow in the browser - uses WebCrypto API automatically
async function startPkceFlow(): Promise<{
  verifier: string;
  challenge: string;
  state: string;
}> {
  const verifier = generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);
  const state = randomUUID();

  return { verifier, challenge, state };
}

// Hash a value using WebCrypto (works in browsers)
async function hashToken(token: string): Promise<string> {
  return sha256Base64url(token);
}

export { startPkceFlow, hashToken };
```

```typescript
// src/server.ts — in-memory DirectMcpServer for the React app.
import { create, tool, z } from '@frontmcp/sdk';

export const server = await create({
  info: { name: 'browser-app', version: '1.0.0' },
  tools: [
    tool({
      name: 'echo',
      description: 'Echo input',
      inputSchema: { msg: z.string() },
    })((input) => ({
      content: [{ type: 'text' as const, text: input.msg }],
    })),
  ],
});
```

```typescript
// src/client-app.tsx
import { FrontMcpProvider, useListTools } from '@frontmcp/react';

import { server } from './server';

// Browser environments cannot use Redis or SQLite. Either keep state in
// memory (DirectMcpServer is in-process) or call a remote server from your
// tools — the SDK does NOT include a built-in browser-side persistence layer.
function App() {
  return (
    <FrontMcpProvider server={server}>
      <ToolDashboard />
    </FrontMcpProvider>
  );
}

function ToolDashboard() {
  const { data } = useListTools();
  const tools = data?.tools ?? [];

  return (
    <div>
      <h1>MCP Tools</h1>
      {tools.map((tool) => (
        <div key={tool.name}>{tool.name}</div>
      ))}
    </div>
  );
}

export default App;
```

## What This Demonstrates

- Using `@frontmcp/utils` for PKCE and hashing in the browser (backed by WebCrypto, not `node:crypto`)
- Creating a `DirectMcpServer` with `create()` and passing it to `FrontMcpProvider` via `server={...}` (no `config={{ serverUrl }}`)
- Using `useListTools` (real hook) instead of the non-existent `useTools`

## Related

- See `build-for-browser` for the complete browser support table and troubleshooting guide
