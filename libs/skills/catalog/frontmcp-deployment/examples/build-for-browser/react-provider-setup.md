---
name: react-provider-setup
reference: build-for-browser
level: basic
description: 'Connect a React application to a remote FrontMCP server using `@frontmcp/react`.'
tags: [deployment, react, browser, remote, provider, setup]
features:
  - 'Wrapping your React app with `FrontMcpProvider` and pointing it at a remote server URL'
  - 'Using the `useTools` hook to list and invoke MCP tools from a React component'
---

# React Provider Setup

Connect a React application to a remote FrontMCP server using `@frontmcp/react`.

## Code

```typescript
// src/App.tsx
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

  const handleClick = async (toolName: string) => {
    const result = await callTool(toolName, { query: 'hello' });
    console.log(result);
  };

  return (
    <ul>
      {tools.map((tool) => (
        <li key={tool.name}>
          <button onClick={() => handleClick(tool.name)}>
            {tool.name}: {tool.description}
          </button>
        </li>
      ))}
    </ul>
  );
}

export default App;
```

## What This Demonstrates

- Wrapping your React app with `FrontMcpProvider` and pointing it at a remote server URL
- Using the `useTools` hook to list and invoke MCP tools from a React component

## Related

- See `build-for-browser` for the full build command and browser limitations
