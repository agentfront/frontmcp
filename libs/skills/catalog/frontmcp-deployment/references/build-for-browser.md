---
name: build-for-browser
description: Build a FrontMCP server or client for browser environments and frontend frameworks
---

# Building for Browser

Build your FrontMCP server or client for browser environments.

## When to Use This Skill

### Must Use

- Building a browser-compatible MCP client or tool interface for a web application
- Embedding MCP tools in a React, Vue, or other frontend framework using `@frontmcp/react`
- Creating a client-side bundle that connects to a remote MCP server

### Recommended

- Prototyping MCP tool UIs in the browser before building a full backend
- Shipping a web-based admin dashboard that lists and invokes MCP tools
- Building a PWA or single-page app that consumes MCP resources

### Skip When

- Running MCP tools on a Node.js server -- use `--target node` or `build-for-cli`
- Embedding MCP in an existing Node.js app without HTTP -- use `build-for-sdk`
- Deploying to Cloudflare Workers or other edge runtimes -- use `deploy-to-cloudflare`

> **Decision:** Choose this skill when the MCP consumer runs in a browser; use server-side build targets for Node.js environments.

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

## Common Patterns

| Pattern           | Correct                                  | Incorrect                         | Why                                        |
| ----------------- | ---------------------------------------- | --------------------------------- | ------------------------------------------ |
| Crypto usage      | `@frontmcp/utils` (uses WebCrypto)       | `node:crypto`                     | `node:crypto` is not available in browsers |
| Storage           | In-memory stores or remote API           | SQLite / Redis directly           | No filesystem or native TCP in browsers    |
| File system ops   | Avoid `@frontmcp/utils` fs functions     | `readFile()`, `writeFile()`       | fs utilities throw in browser environments |
| Entry file        | Separate browser entry (`src/client.ts`) | Reusing server entry point        | Server entry may import Node-only modules  |
| Server connection | `FrontMcpProvider` with `serverUrl`      | Direct `connect()` with localhost | Browser needs a remote URL, not localhost  |

## Verification Checklist

**Build**

- [ ] `frontmcp build --target browser` completes without errors
- [ ] Output directory contains browser-compatible JS bundle
- [ ] No Node.js-only modules are included in the bundle

**Runtime**

- [ ] Bundle loads in the browser without console errors
- [ ] MCP tools are listed and callable from the frontend
- [ ] WebCrypto-based operations (auth, PKCE) work correctly

**Integration**

- [ ] `@frontmcp/react` provider connects to the remote MCP server
- [ ] Tool invocations return expected results in the UI
- [ ] Resources and prompts render correctly in browser components

## Troubleshooting

| Problem                     | Cause                                     | Solution                                                         |
| --------------------------- | ----------------------------------------- | ---------------------------------------------------------------- |
| `Module not found: fs`      | Node.js module imported in browser bundle | Use a separate browser entry point that avoids Node-only imports |
| `crypto is not defined`     | Using `node:crypto` instead of WebCrypto  | Switch to `@frontmcp/utils` crypto functions                     |
| CORS errors on tool calls   | MCP server missing CORS headers           | Configure CORS middleware on the MCP server                      |
| Bundle too large            | All server-side code included             | Use `--target browser` and a dedicated client entry file         |
| `@frontmcp/utils` fs throws | File system ops called in browser         | Remove fs calls; use API endpoints or in-memory alternatives     |

## Reference

- **Docs:** <https://docs.agentfront.dev/frontmcp/deployment/browser-compatibility>
- **Related skills:** `build-for-sdk`, `build-for-cli`, `deploy-to-cloudflare`
