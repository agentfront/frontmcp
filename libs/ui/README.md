# @frontmcp/ui

React components, hooks, and rendering utilities for building interactive MCP widgets.

## Package Split

This package is part of a two-package system:

| Package              | Purpose                                                   | React Required |
| -------------------- | --------------------------------------------------------- | -------------- |
| **@frontmcp/ui**     | React components, hooks, SSR rendering                    | Yes            |
| **@frontmcp/uipack** | Bundling, build tools, HTML components, platform adapters | No             |

If you only need build tools or HTML components without React, use `@frontmcp/uipack` instead.

## Installation

```bash
npm install @frontmcp/ui react react-dom
# or
yarn add @frontmcp/ui react react-dom
```

## Features

- **React Components** - Button, Card, Alert, Badge, and more
- **MCP Bridge Hooks** - `useMcpBridge`, `useCallTool`, `useToolInput`, `useToolOutput`
- **Server-Side Rendering** - React 18/19 SSR via `react-dom/server`
- **Client-Side Hydration** - Hydrate SSR content for interactivity
- **Universal App Shell** - Platform-agnostic React wrapper

## Quick Start

### React Components

```typescript
import { Button, Card, Alert, Badge } from '@frontmcp/ui/react';

function MyWidget() {
  return (
    <Card title="Welcome">
      <Alert variant="info">Hello, world!</Alert>
      <Button variant="primary" onClick={handleClick}>
        Get Started
      </Button>
      <Badge variant="success">Active</Badge>
    </Card>
  );
}
```

### MCP Bridge Hooks

```typescript
import { useMcpBridge, useCallTool, useToolInput, useToolOutput } from '@frontmcp/ui/react/hooks';

function ToolWidget() {
  const bridge = useMcpBridge();
  const { call, loading, error } = useCallTool();
  const input = useToolInput();
  const output = useToolOutput();

  const handleClick = async () => {
    await call('my-tool', { data: input.query });
  };

  return (
    <div>
      <p>Query: {input.query}</p>
      {loading && <p>Loading...</p>}
      {error && <p>Error: {error.message}</p>}
      {output && <pre>{JSON.stringify(output, null, 2)}</pre>}
      <button onClick={handleClick}>Run Tool</button>
    </div>
  );
}
```

### Universal App Shell

```typescript
import { UniversalApp, FrontMCPProvider } from '@frontmcp/ui/universal';

function App() {
  return (
    <FrontMCPProvider>
      <UniversalApp>
        <ToolWidget />
      </UniversalApp>
    </FrontMCPProvider>
  );
}
```

## Entry Points

| Path                       | Exports                                    |
| -------------------------- | ------------------------------------------ |
| `@frontmcp/ui`             | Main exports (React components, renderers) |
| `@frontmcp/ui/react`       | React components                           |
| `@frontmcp/ui/react/hooks` | MCP bridge hooks                           |
| `@frontmcp/ui/renderers`   | ReactRenderer, ReactRendererAdapter        |
| `@frontmcp/ui/render`      | React 19 static rendering                  |
| `@frontmcp/ui/universal`   | Universal app shell                        |
| `@frontmcp/ui/bundler`     | SSR component bundler                      |

## Server-Side Rendering

### ReactRenderer (SSR)

```typescript
import { ReactRenderer, reactRenderer } from '@frontmcp/ui/renderers';

// Render React component to HTML string
const html = await reactRenderer.render(MyComponent, {
  input: { query: 'test' },
  output: { result: 'data' },
});
```

### ReactRendererAdapter (Client-Side)

```typescript
import { ReactRendererAdapter, createReactAdapter } from '@frontmcp/ui/renderers';

const adapter = createReactAdapter();

// Hydrate SSR content
await adapter.hydrate(targetElement, context);

// Render new content
await adapter.renderToDOM(content, targetElement, context);

// Update with new data
await adapter.update(targetElement, newContext);

// Cleanup
adapter.destroy(targetElement);
```

## SSR Bundling

```typescript
import { InMemoryBundler, createBundler } from '@frontmcp/ui/bundler';

const bundler = createBundler({ cache: true });

// Bundle a React component for SSR
const result = await bundler.bundle('./components/MyWidget.tsx');
```

## Using with @frontmcp/uipack

For React-free utilities, import from `@frontmcp/uipack`:

```typescript
// Build tools (no React)
import { buildToolUI, getOutputModeForClient } from '@frontmcp/uipack/build';

// HTML string components (no React)
import { button, card, alert } from '@frontmcp/uipack/components';

// Platform adapters
import { buildToolDiscoveryMeta } from '@frontmcp/uipack/adapters';
import type { AIPlatformType } from '@frontmcp/uipack/adapters';

// Theme system
import { DEFAULT_THEME, createTheme } from '@frontmcp/uipack/theme';
```

## Peer Dependencies

```json
{
  "peerDependencies": {
    "react": "^18.0.0 || ^19.0.0",
    "react-dom": "^18.0.0 || ^19.0.0",
    "@frontmcp/uipack": "^0.6.0"
  }
}
```

## Development

### Building

```bash
yarn nx build ui
```

### Testing

```bash
yarn nx test ui
```

## Related Packages

- **[@frontmcp/uipack](../uipack/README.md)** - React-free bundling, build tools, HTML components
- **[@frontmcp/sdk](../sdk/README.md)** - Core FrontMCP SDK
- **[@frontmcp/testing](../testing/README.md)** - E2E testing utilities

## License

Apache-2.0
