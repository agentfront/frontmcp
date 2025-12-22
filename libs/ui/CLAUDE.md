# @frontmcp/ui - Development Guidelines

## Overview

`@frontmcp/ui` provides **React components, hooks, and rendering utilities** for building interactive MCP widgets.

This package requires React. For React-free utilities (bundling, build tools, HTML components, platform adapters), use `@frontmcp/uipack`.

**Key Principles:**

- React 18/19 components with TypeScript
- SSR support via `react-dom/server`
- Client-side hydration for interactive widgets
- MCP bridge hooks for tool communication

## Architecture

```text
libs/ui/src/
├── react/              # React components and hooks
│   ├── components/     # Button, Card, Alert, Badge, etc.
│   └── hooks/          # useMcpBridge, useCallTool, useToolInput
├── render/             # React 19 static rendering utilities
├── renderers/          # React renderer for template processing
│   ├── react.renderer.ts   # SSR renderer (react-dom/server)
│   └── react.adapter.ts    # Client-side hydration adapter
├── bundler/            # SSR component bundling
├── universal/          # Universal React app shell
└── index.ts            # Main barrel exports
```

## Package Split

| Package            | Purpose                                                   | React Required |
| ------------------ | --------------------------------------------------------- | -------------- |
| `@frontmcp/ui`     | React components, hooks, SSR                              | Yes            |
| `@frontmcp/uipack` | Bundling, build tools, HTML components, platform adapters | No             |

### Import Patterns

```typescript
// React components and hooks (this package)
import { Button, Card, Alert } from '@frontmcp/ui/react';
import { useMcpBridge, useCallTool } from '@frontmcp/ui/react/hooks';

// SSR rendering
import { ReactRenderer, reactRenderer } from '@frontmcp/ui/renderers';

// Universal app shell
import { UniversalApp, FrontMCPProvider } from '@frontmcp/ui/universal';

// React-free utilities (from @frontmcp/uipack)
import { buildToolUI } from '@frontmcp/uipack/build';
import { button, card } from '@frontmcp/uipack/components';
import type { AIPlatformType } from '@frontmcp/uipack/adapters';
```

## React Components

### Available Components

```typescript
import {
  Button,
  Card,
  Alert,
  Badge,
  // ... more components
} from '@frontmcp/ui/react';

// Usage
<Button variant="primary" onClick={handleClick}>
  Submit
</Button>

<Card title="Welcome">
  <p>Card content</p>
</Card>
```

### MCP Bridge Hooks

```typescript
import { useMcpBridge, useCallTool, useToolInput, useToolOutput } from '@frontmcp/ui/react/hooks';

function MyWidget() {
  const bridge = useMcpBridge();
  const { call, loading, error } = useCallTool();
  const input = useToolInput();
  const output = useToolOutput();

  return (
    <div>
      <p>Input: {JSON.stringify(input)}</p>
      <p>Output: {JSON.stringify(output)}</p>
      <button onClick={() => call('my-tool', { data: 'test' })}>Call Tool</button>
    </div>
  );
}
```

## React Renderer

### Server-Side Rendering

```typescript
import { ReactRenderer, reactRenderer } from '@frontmcp/ui/renderers';

// Render React component to HTML string
const html = await reactRenderer.render(MyComponent, context);
```

### Client-Side Hydration

```typescript
import { ReactRendererAdapter, createReactAdapter } from '@frontmcp/ui/renderers';

// Create adapter for client-side rendering
const adapter = createReactAdapter();

// Hydrate existing SSR content
await adapter.hydrate(targetElement, context);

// Render new content
await adapter.renderToDOM(content, targetElement, context);
```

## Universal App

The universal app provides a platform-agnostic React shell:

```typescript
import { UniversalApp, FrontMCPProvider } from '@frontmcp/ui/universal';

function App() {
  return (
    <FrontMCPProvider>
      <UniversalApp>
        <MyWidget />
      </UniversalApp>
    </FrontMCPProvider>
  );
}
```

## SSR Bundling

```typescript
import { InMemoryBundler, createBundler } from '@frontmcp/ui/bundler';

// Create bundler for SSR components
const bundler = createBundler({
  cache: true,
});

// Bundle a React component for SSR
const result = await bundler.bundle(componentPath);
```

## Dependencies

```json
{
  "peerDependencies": {
    "react": "^18.0.0 || ^19.0.0",
    "react-dom": "^18.0.0 || ^19.0.0",
    "@frontmcp/uipack": "^0.6.0"
  }
}
```

## Testing Requirements

- **Coverage**: 95%+ across statements, branches, functions, lines
- **React Testing Library**: Use for component tests
- **SSR Tests**: Test server-side rendering output
- **Hydration Tests**: Test client-side hydration

## Entry Points

| Path                       | Purpose                                    |
| -------------------------- | ------------------------------------------ |
| `@frontmcp/ui`             | Main exports (React components, renderers) |
| `@frontmcp/ui/react`       | React components                           |
| `@frontmcp/ui/react/hooks` | MCP bridge hooks                           |
| `@frontmcp/ui/renderers`   | ReactRenderer, ReactRendererAdapter        |
| `@frontmcp/ui/render`      | React 19 static rendering                  |
| `@frontmcp/ui/universal`   | Universal app shell                        |
| `@frontmcp/ui/bundler`     | SSR component bundler                      |

## Anti-Patterns to Avoid

- Importing React-free utilities from `@frontmcp/ui` (use `@frontmcp/uipack`)
- Using `any` type without justification
- Skipping SSR/hydration testing
- Missing TypeScript types for props
- Not handling loading/error states in hooks

## Related Packages

- **@frontmcp/uipack** - React-free bundling, build tools, HTML components
- **@frontmcp/sdk** - Core FrontMCP SDK
- **@frontmcp/testing** - E2E testing utilities
