---
name: react-provider-setup
reference: build-for-browser
level: basic
description: 'Connect a React application to a FrontMCP server using `@frontmcp/react` with a real `DirectMcpServer` instance.'
tags: [deployment, react, browser, provider, setup]
features:
  - 'Wrapping your React app with `FrontMcpProvider` and passing a `DirectMcpServer` via `server={...}`'
  - 'Using the `useListTools` and `useCallTool` hooks'
  - 'Creating the server with `create()` from `@frontmcp/sdk`'
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
  const { data } = useListTools();
  const { mutate: callTool } = useCallTool();
  const tools = data?.tools ?? [];

  return (
    <ul>
      {tools.map((t) => (
        <li key={t.name}>
          <button
            onClick={() => callTool({ name: t.name, arguments: { name: 'World' } })}
          >
            {t.name}: {t.description}
          </button>
        </li>
      ))}
    </ul>
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
