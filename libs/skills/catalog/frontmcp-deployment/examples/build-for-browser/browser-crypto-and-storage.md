---
name: browser-crypto-and-storage
reference: build-for-browser
level: advanced
description: 'Use `@frontmcp/utils` crypto functions (WebCrypto API) and in-memory storage in browser environments.'
tags: [deployment, browser, database, remote, node, crypto]
features:
  - 'Using `@frontmcp/utils` for PKCE and hashing in the browser (backed by WebCrypto, not `node:crypto`)'
  - 'Avoiding filesystem and native database storage in browser builds by relying on a remote server for persistence'
---

# Browser-Safe Crypto and Storage

Use `@frontmcp/utils` crypto functions (WebCrypto API) and in-memory storage in browser environments.

## Code

```typescript
// src/browser-auth.ts
import { generateCodeVerifier, generateCodeChallenge, sha256Base64url, randomUUID } from '@frontmcp/utils';

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
// src/client-app.tsx
import { FrontMcpProvider, useTools } from '@frontmcp/react';

// Browser environments cannot use Redis or SQLite.
// Use in-memory stores or connect to a remote server that handles persistence.
function App() {
  return (
    <FrontMcpProvider
      config={{
        serverUrl: 'https://my-mcp.example.com',
        // No local storage config - the remote server handles persistence
      }}
    >
      <ToolDashboard />
    </FrontMcpProvider>
  );
}

function ToolDashboard() {
  const { tools, callTool } = useTools();

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
- Avoiding filesystem and native database storage in browser builds by relying on a remote server for persistence

## Related

- See `build-for-browser` for the complete browser support table and troubleshooting guide
