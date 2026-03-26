---
name: build-for-browser
description: Build a FrontMCP server for browser environments. Use when creating browser-compatible MCP clients, embedding MCP in web apps, or building client-side tool interfaces.
tags: [deployment, browser, client, web, frontend]
examples:
  - scenario: Build browser bundle for a React web application
    expected-outcome: Browser-compatible JS bundle importable in frontend code
  - scenario: Create a browser-based MCP client
    expected-outcome: Client-side MCP tools running in the browser
priority: 6
visibility: both
license: Apache-2.0
metadata:
  docs: https://docs.agentfront.dev/frontmcp/deployment/browser-compatibility
---

# Building for Browser

Build your FrontMCP server or client for browser environments.

## When to Use

Use `--target browser` when:

- Embedding MCP tools in a web application
- Building a browser-based MCP client with `@frontmcp/react`
- Creating client-side tool interfaces that connect to a remote MCP server

## Build Command

```bash
frontmcp build --target browser
```

### Options

```bash
frontmcp build --target browser -o ./dist/browser   # Custom output directory
frontmcp build --target browser -e ./src/client.ts   # Custom entry file
```

## Browser Limitations

Not all FrontMCP features are available in browser environments:

| Feature                     | Browser Support | Notes                                     |
| --------------------------- | --------------- | ----------------------------------------- |
| Tools (client-side)         | Yes             | Can define and run tools                  |
| Resources                   | Yes             | Read-only access                          |
| Prompts                     | Yes             | Full support                              |
| Redis                       | No              | Use in-memory or connect to server        |
| SQLite                      | No              | No filesystem access                      |
| File system utilities       | No              | `@frontmcp/utils` fs ops throw in browser |
| Crypto (`@frontmcp/utils`)  | Yes             | Uses WebCrypto API                        |
| Direct client (`connect()`) | Yes             | In-memory connection                      |

## Usage with @frontmcp/react

The browser build is commonly paired with `@frontmcp/react` for React applications:

```typescript
import { FrontMcpProvider, useTools } from '@frontmcp/react';

function App() {
  return (
    <FrontMcpProvider config={{ serverUrl: 'https://my-mcp.example.com' }}>
      <ToolUI />
    </FrontMcpProvider>
  );
}

function ToolUI() {
  const { tools, callTool } = useTools();
  // Use tools in your React components
}
```

## Browser vs Node vs SDK Target

| Aspect      | `--target browser` | `--target node`   | `--target sdk`      |
| ----------- | ------------------ | ----------------- | ------------------- |
| Runtime     | Browser            | Node.js server    | Node.js library     |
| Output      | Browser bundle     | Server executable | CJS + ESM + types   |
| HTTP server | No                 | Yes               | No (`serve: false`) |
| Use case    | Frontend apps      | Standalone server | Embed in Node apps  |

## Verification

```bash
# Build
frontmcp build --target browser

# Check output
ls dist/browser/
```
