# @frontmcp/ui

FrontMCP's platform-aware UI toolkit for building HTML widgets, web components, and React surfaces that run inside MCP transports. It renders plain strings by default (perfect for agents and dual-payload responses) and exposes React renderers, web components, and bundling helpers so you can reuse the same design system everywhere.

## Package Split

| Package            | Purpose                                                         | React Required        |
| ------------------ | --------------------------------------------------------------- | --------------------- |
| `@frontmcp/ui`     | HTML components, layouts, widgets, React components/hooks       | Yes (peer dependency) |
| `@frontmcp/uipack` | Themes, build/render pipelines, runtime helpers, template types | No                    |

Use `@frontmcp/ui` for components and renderers. Pair it with `@frontmcp/uipack` for theming, build-time tooling, validation, and platform adapters.

## Installation

```bash
npm install @frontmcp/ui @frontmcp/uipack react react-dom
# or
yarn add @frontmcp/ui @frontmcp/uipack react react-dom
```

## Features

- **HTML-first components** – Buttons, cards, badges, alerts, forms, tables, layouts, and widgets that return ready-to-stream HTML strings.
- **React + SSR** – Optional React components, hooks, and renderers so you can hydrate widgets when the host allows it.
- **MCP Bridge helpers** – Generate bridge bundles, wrap tool responses, and expose follow-up actions from inside widgets.
- **Web components** – Register `<fmcp-button>`, `<fmcp-card>`, and friends for projects that prefer custom elements.
- **Validation + error boxes** – Every component validates its options with Zod and renders a friendly error when something is misconfigured.
- **Works with uipack** – Import themes, runtime helpers, adapters, and build APIs from `@frontmcp/uipack` to keep HTML and React outputs in sync.

## Quick Start

### HTML components

```ts
import { card, button } from '@frontmcp/ui/components';
import { baseLayout } from '@frontmcp/ui/layouts';
import { DEFAULT_THEME } from '@frontmcp/uipack/theme';

const widget = card(
  `
  <h2 class="text-lg font-semibold">CRM Access</h2>
  <p>Grant the orchestrator access to customer data.</p>
  ${button('Approve', { variant: 'primary', type: 'submit' })}
`,
  { variant: 'elevated' },
);

const html = baseLayout(widget, {
  title: 'Authorize CRM',
  description: 'Let the agent read CRM data for this session.',
  theme: DEFAULT_THEME,
  width: 'md',
  align: 'center',
  scripts: { tailwind: true, htmx: true },
});
```

### React components

```tsx
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

### MCP Bridge hooks

```tsx
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

### Universal app shell

```tsx
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

## Entry points

| Path                          | Exports                                            |
| ----------------------------- | -------------------------------------------------- |
| `@frontmcp/ui/components`     | HTML components, helpers, error boxes              |
| `@frontmcp/ui/layouts`        | Base layouts, consent/error templates              |
| `@frontmcp/ui/pages`          | High-level page templates                          |
| `@frontmcp/ui/widgets`        | OpenAI App SDK-style widgets                       |
| `@frontmcp/ui/react`          | React components                                   |
| `@frontmcp/ui/react/hooks`    | MCP Bridge React hooks                             |
| `@frontmcp/ui/renderers`      | ReactRenderer + adapter helpers                    |
| `@frontmcp/ui/render`         | React 19 static rendering utilities                |
| `@frontmcp/ui/web-components` | `<fmcp-*>` custom elements                         |
| `@frontmcp/ui/bridge`         | Bridge registry + adapters                         |
| `@frontmcp/ui/bundler`        | SSR/component bundler (uses uipack under the hood) |

Use `@frontmcp/uipack/theme`, `@frontmcp/uipack/runtime`, and `@frontmcp/uipack/build` for theming, runtime helpers, and build-time APIs.

## Server-side rendering

### ReactRenderer (SSR)

```ts
import { ReactRenderer, reactRenderer } from '@frontmcp/ui/renderers';

const html = await reactRenderer.render(MyComponent, {
  input: { query: 'test' },
  output: { result: 'data' },
});
```

### ReactRendererAdapter (client hydration)

```ts
import { ReactRendererAdapter, createReactAdapter } from '@frontmcp/ui/renderers';

const adapter = createReactAdapter();
await adapter.hydrate(targetElement, context);
await adapter.renderToDOM(content, targetElement, context);
adapter.destroy(targetElement);
```

## SSR bundling

```ts
import { InMemoryBundler, createBundler } from '@frontmcp/ui/bundler';

const bundler = createBundler({ cache: true });
const result = await bundler.bundle('./components/MyWidget.tsx');
```

## Using with @frontmcp/uipack

```ts
// Theme + scripts
import { DEFAULT_THEME, createTheme } from '@frontmcp/uipack/theme';

// Build API & adapters
import { buildToolUI, buildToolDiscoveryMeta } from '@frontmcp/uipack/build';

// Runtime helpers
import { wrapToolUI, createTemplateHelpers } from '@frontmcp/uipack/runtime';

// Validation + utils
import { validateOptions } from '@frontmcp/uipack/validation';
```

`@frontmcp/uipack` lets you configure themes, register cached widgets, wrap templates with CSP, and emit platform-specific metadata without pulling React into HTML-only projects.

## Peer dependencies

```json
{
  "peerDependencies": {
    "react": "^18.0.0 || ^19.0.0",
    "react-dom": "^18.0.0 || ^19.0.0",
    "@frontmcp/uipack": "^0.6.1"
  }
}
```

## Development

```bash
yarn nx build ui
yarn nx test ui
```

## Related packages

- [`@frontmcp/uipack`](../uipack/README.md) – React-free themes, runtime helpers, build tooling
- [`@frontmcp/sdk`](../sdk/README.md) – Core SDK
- [`@frontmcp/testing`](../testing/README.md) – UI assertions and fixtures

## License

Apache-2.0
