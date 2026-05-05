---
name: react-provider-setup
reference: build-for-browser
level: basic
description: Connect a React application to a FrontMCP server using `@frontmcp/react`. `FrontMcpProvider` takes a `DirectMcpServer` instance via the `server` prop — there is no `serverUrl` option.
tags:
  - deployment
  - react
  - browser
  - provider
  - setup
features:
  - Wrapping your React app with `FrontMcpProvider` and passing a real `DirectMcpServer` via `server={...}`
  - Using `useListTools` to fetch the tools list and `useCallTool` to invoke one
  - Creating the server with `create()` from `@frontmcp/sdk` (in-memory direct connection)
---

# React Provider Setup

Connect a React application to a FrontMCP server using `@frontmcp/react`. `FrontMcpProvider` takes a `DirectMcpServer` instance via the `server` prop — there is no `serverUrl` option.

## Code

```typescript
// src/server.ts — create a DirectMcpServer (in-memory) for the React app to consume.
import { create, tool, z } from '@frontmcp/sdk';

export const server = await create({
  info: { name: 'browser-app', version: '1.0.0' },
  tools: [
    tool({
      name: 'greet',
      description: 'Greet a user',
      inputSchema: { name: z.string() },
    })((input) => ({
      content: [{ type: 'text' as const, text: `Hello, ${input.name}!` }],
    })),
  ],
});
```

```typescript
// src/App.tsx
import { FrontMcpProvider, useCallTool, useListTools } from '@frontmcp/react';

import { server } from './server';

function App() {
  return (
    <FrontMcpProvider server={server}>
      <ToolUI />
    </FrontMcpProvider>
  );
}

function ToolUI() {
  // useListTools returns ToolInfo[] directly (live-updates from the registry).
  const tools = useListTools();
  return (
    <ul>
      {tools.map((t) => (
        <li key={t.name}>
          <ToolButton tool={t} />
        </li>
      ))}
    </ul>
  );
}

// useCallTool requires the tool name as a hook arg, so each row owns its own
// hook instance. The mutate fn takes just the arguments object — not `{ name, arguments }`.
function ToolButton({ tool }: { tool: { name: string; description?: string } }) {
  const [callTool] = useCallTool<{ name: string }>(tool.name);
  return (
    <button onClick={() => callTool({ name: 'World' })}>
      {tool.name}: {tool.description}
    </button>
  );
}

export default App;
```

## What This Demonstrates

- Wrapping your React app with `FrontMcpProvider` and passing a real `DirectMcpServer` via `server={...}`
- Using `useListTools` to fetch the tools list and `useCallTool` to invoke one
- Creating the server with `create()` from `@frontmcp/sdk` (in-memory direct connection)

## Related

- See `build-for-browser` for the full build command and browser limitations
- See `build-for-sdk` for the `create()` factory and `tool()` builder
