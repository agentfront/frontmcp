# @frontmcp/ui - Development Guidelines

## Overview

`@frontmcp/ui` provides **React components, hooks, and rendering utilities** for building interactive MCP widgets.

This package requires React. For React-free utilities (bundling, build tools, platform adapters, theme), use `@frontmcp/uipack`.

**Key Principles:**

- React 18/19 components with TypeScript
- SSR support via `react-dom/server`
- Client-side hydration for interactive widgets
- MCP bridge hooks for tool communication

## Architecture

```text
libs/ui/src/
├── bridge/             # MCP bridge runtime and adapters
├── bundler/            # SSR component bundling (re-exports from uipack)
├── components/         # HTML string components (button, card, etc.)
├── layouts/            # Page layout templates
├── react/              # React components and hooks
│   ├── Card.tsx        # Card component
│   ├── Button.tsx      # Button component
│   ├── Alert.tsx       # Alert component
│   ├── Badge.tsx       # Badge component
│   └── hooks/          # useMcpBridge, useCallTool, useToolInput
├── render/             # React 19 static rendering utilities
├── renderers/          # React renderer for template processing
│   ├── react.renderer.ts   # SSR renderer (react-dom/server)
│   ├── react.adapter.ts    # Client-side hydration adapter
│   └── mdx.renderer.ts     # MDX server-side renderer
├── universal/          # Universal React app shell
├── web-components/     # Custom HTML elements
└── index.ts            # Main barrel exports
```

## Package Split

| Package            | Purpose                                         | React Required |
| ------------------ | ----------------------------------------------- | -------------- |
| `@frontmcp/ui`     | React components, hooks, SSR, HTML components   | Yes            |
| `@frontmcp/uipack` | Bundling, build tools, platform adapters, theme | No             |

### Import Patterns

```typescript
// React components and hooks (this package)
import { Button, Card, Alert, Badge } from '@frontmcp/ui/react';
import { useMcpBridge, useCallTool, useToolInput } from '@frontmcp/ui/react';

// SSR rendering
import { ReactRenderer, reactRenderer, MdxRenderer, mdxRenderer } from '@frontmcp/ui/renderers';

// Universal app shell
import { UniversalApp, FrontMCPProvider } from '@frontmcp/ui/universal';

// HTML string components
import { button, card, alert, badge } from '@frontmcp/ui/components';

// MCP bridge
import { FrontMcpBridge, createBridge } from '@frontmcp/ui/bridge';

// React-free utilities (from @frontmcp/uipack)
import { buildToolUI } from '@frontmcp/uipack/build';
import { DEFAULT_THEME } from '@frontmcp/uipack/theme';
import type { AIPlatformType } from '@frontmcp/uipack/adapters';
```

## React Components

### Available Components

```typescript
import { Card, Badge, Button, Alert } from '@frontmcp/ui/react';

// Usage
<Button variant="primary" onClick={handleClick}>
  Submit
</Button>

<Card title="Welcome" variant="elevated">
  <p>Card content</p>
</Card>

<Badge variant="success">Active</Badge>

<Alert variant="warning" title="Warning">
  Please check your input
</Alert>
```

### MCP Bridge Hooks

```typescript
import {
  McpBridgeProvider,
  useMcpBridge,
  useCallTool,
  useToolInput,
  useToolOutput,
  useTheme,
} from '@frontmcp/ui/react';

function MyWidget() {
  const input = useToolInput<{ location: string }>();
  const theme = useTheme();
  const [getWeather, { data, loading }] = useCallTool('get_weather');

  return <Card title={`Weather for ${input?.location}`}>{loading ? 'Loading...' : data?.temperature}</Card>;
}

// Wrap your app with the provider
function App() {
  return (
    <McpBridgeProvider>
      <MyWidget />
    </McpBridgeProvider>
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

### MDX Server Rendering

```typescript
import { MdxRenderer, mdxRenderer } from '@frontmcp/ui/renderers';

// Render MDX to HTML with React components
const html = await mdxRenderer.render('# Hello {output.name}', context);
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

The bundler re-exports utilities from `@frontmcp/uipack/bundler`:

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

| Path                          | Purpose                                    |
| ----------------------------- | ------------------------------------------ |
| `@frontmcp/ui`                | Main exports (React components, renderers) |
| `@frontmcp/ui/react`          | React components and hooks                 |
| `@frontmcp/ui/renderers`      | ReactRenderer, MdxRenderer, adapters       |
| `@frontmcp/ui/render`         | React 19 static rendering                  |
| `@frontmcp/ui/universal`      | Universal app shell                        |
| `@frontmcp/ui/bundler`        | SSR component bundler                      |
| `@frontmcp/ui/bridge`         | MCP bridge runtime                         |
| `@frontmcp/ui/components`     | HTML string components                     |
| `@frontmcp/ui/layouts`        | Page layout templates                      |
| `@frontmcp/ui/web-components` | Custom HTML elements                       |

## Anti-Patterns to Avoid

- Importing React-free utilities from `@frontmcp/ui` (use `@frontmcp/uipack`)
- Using `any` type without justification
- Skipping SSR/hydration testing
- Missing TypeScript types for props
- Not handling loading/error states in hooks

## Related Packages

- **@frontmcp/uipack** - React-free bundling, build tools, theme, platform adapters
- **@frontmcp/sdk** - Core FrontMCP SDK
- **@frontmcp/testing** - E2E testing utilities
