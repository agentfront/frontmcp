# @frontmcp/react

React hooks, components, and AI SDK integration for [FrontMCP](https://docs.agentfront.dev). Build AI-agent-powered UIs with idiomatic React patterns.

## Installation

```bash
npm install @frontmcp/react react react-dom
```

`@frontmcp/sdk` and `@frontmcp/utils` are bundled as dependencies and installed automatically.

Optional peer dependencies:

- `zod` (^4.0.0) — for type-safe schemas with `mcpComponent` and `useDynamicTool`
- `react-router-dom` (^7.0.0) — for `/router` entry point

## Entry Points

| Import                   | Purpose                                                                   |
| ------------------------ | ------------------------------------------------------------------------- |
| `@frontmcp/react`        | Provider, hooks, components, ServerRegistry, and SDK re-exports           |
| `@frontmcp/react/ai`     | AI SDK integration (`useAITools`, `useTools`, `createToolCallHandler`)    |
| `@frontmcp/react/router` | React Router bridge (`useRouterBridge`, navigation tools, route resource) |
| `@frontmcp/react/state`  | State management integration (Redux, Valtio, generic, store adapters)     |
| `@frontmcp/react/api`    | API client integration (OpenAPI, custom HTTP clients)                     |

## Quick Start

```tsx
import { create } from '@frontmcp/react';
import { FrontMcpProvider, useCallTool } from '@frontmcp/react';

const server = await create({
  info: { name: 'my-app', version: '1.0.0' },
  tools: [GreetTool],
});

function App() {
  return (
    <FrontMcpProvider server={server}>
      <GreetButton />
    </FrontMcpProvider>
  );
}

function GreetButton() {
  const [callTool, { data, loading }] = useCallTool('greet');
  return (
    <button onClick={() => callTool({ name: 'World' })} disabled={loading}>
      {data ? String(data) : 'Greet'}
    </button>
  );
}
```

No need to install `@frontmcp/sdk` separately -- `@frontmcp/react` re-exports `create`, `connect`, decorators, and context classes.

## SDK Re-exports

`@frontmcp/react` re-exports the most commonly used SDK symbols so you can use a single import:

- **Factory**: `create`, `connect`, `connectOpenAI`, `connectClaude`, `connectVercelAI`
- **Decorators**: `Tool`, `Resource`, `ResourceTemplate`, `Prompt`, `App`, `FrontMcp`, `Plugin`, `Adapter`
- **Context Classes**: `ToolContext`, `ResourceContext`, `PromptContext`, `ExecutionContextBase`
- **Protocol Types**: `CallToolResult`, `ReadResourceResult`, `GetPromptResult`, etc.

## Provider

```tsx
import { FrontMcpProvider } from '@frontmcp/react';

<FrontMcpProvider server={server} autoConnect>
  <App />
</FrontMcpProvider>;
```

The provider manages the MCP client lifecycle. It supports multi-server setups, `autoConnect`, and provider-level store adapters.

## Agent Components

### mcpComponent (Recommended)

Type-safe factory that wraps a React component + zod schema into an MCP-registered component:

```tsx
import { mcpComponent } from '@frontmcp/react';
import { z } from 'zod';

const WeatherCard = mcpComponent(
  ({ city, temp }) => (
    <div>
      <h2>{city}</h2>
      <p>{temp}°</p>
    </div>
  ),
  {
    name: 'show_weather',
    description: 'Display weather data',
    schema: z.object({ city: z.string(), temp: z.number() }),
    fallback: <p>Loading...</p>,
  },
);

// Use like a normal component
<WeatherCard />;
```

### Table Mode

When `component` is `null` and `columns` is provided, renders a `<table>`:

```tsx
const OrderTable = mcpComponent(null, {
  name: 'show_orders',
  schema: z.object({ id: z.string(), product: z.string(), price: z.number() }),
  columns: [
    { key: 'id', header: 'Order ID' },
    { key: 'product', header: 'Product' },
    { key: 'price', header: 'Price', render: (v) => `$${v}` },
  ],
});
```

## Hooks

### Core Hooks

| Hook                              | Description                                    |
| --------------------------------- | ---------------------------------------------- |
| `useCallTool(name, options?)`     | Call an MCP tool with typed input/output       |
| `useReadResource(uri?, options?)` | Lazy or auto-fetch resource reading            |
| `useGetPrompt(name, options?)`    | Fetch an MCP prompt by name                    |
| `useListTools(options?)`          | Reactive tool list from the registry           |
| `useListResources(options?)`      | Reactive resource and template lists           |
| `useListPrompts(options?)`        | Reactive prompt list                           |
| `useStoreResource(uri, options?)` | Subscribe to `state://` URIs with live updates |

### Dynamic Hooks

| Hook                          | Description                                              |
| ----------------------------- | -------------------------------------------------------- |
| `useDynamicTool(options)`     | Register an MCP tool on mount, unregister on unmount     |
| `useDynamicResource(options)` | Register an MCP resource on mount, unregister on unmount |
| `useComponentTree(options)`   | Expose the DOM subtree under a ref as an MCP resource    |

All hooks accept `{ server: 'name' }` to target a specific server in multi-server setups.

### useDynamicTool with Zod

```tsx
import { z } from 'zod';

useDynamicTool({
  name: 'add_to_cart',
  description: 'Add item to shopping cart',
  schema: z.object({
    itemId: z.string(),
    quantity: z.number().optional(),
  }),
  execute: async (args) => {
    // args is typed as { itemId: string; quantity?: number }
    addToCart(args.itemId, args.quantity ?? 1);
    return { content: [{ type: 'text', text: 'Added to cart' }] };
  },
  enabled: isLoggedIn,
});
```

Also supports raw JSON Schema via `inputSchema` for backward compatibility.

## State Management

`@frontmcp/react/state` exposes your application state as MCP resources and actions as tools.

### Hook-based (inside components)

```tsx
import { useReduxResource, useValtioResource } from '@frontmcp/react/state';

useReduxResource({
  store: reduxStore,
  selectors: { todos: (s) => s.todos },
  actions: { addTodo: (text) => ({ type: 'ADD_TODO', payload: text }) },
});
```

### Provider-level Store Adapters

Register stores directly on `FrontMcpProvider` without hooks:

```tsx
import { FrontMcpProvider, reduxStore, valtioStore, createStore } from '@frontmcp/react';

<FrontMcpProvider
  server={server}
  stores={[
    reduxStore({
      store,
      selectors: { count: (s) => s.count },
      actions: { inc: () => increment() },
    }),
    valtioStore({
      proxy,
      subscribe,
      paths: { userName: 'user.name' },
    }),
    createStore({
      name: 'custom',
      getState,
      subscribe: customSubscribe,
    }),
  ]}
>
  <App />
</FrontMcpProvider>;
```

## API Client

`@frontmcp/react/api` registers OpenAPI operations as MCP tools with a pluggable HTTP client.

```tsx
import { useApiClient, parseOpenApiSpec, createFetchClient } from '@frontmcp/react/api';

useApiClient({
  baseUrl: 'https://api.example.com',
  operations: parseOpenApiSpec(spec),
  client: createFetchClient(),
});
```

## Components

| Component           | Description                                          |
| ------------------- | ---------------------------------------------------- |
| `ToolForm`          | Auto-generates forms from tool `inputSchema`         |
| `PromptForm`        | Generates forms from prompt arguments                |
| `ResourceViewer`    | Displays `ReadResourceResult` contents               |
| `OutputDisplay`     | Renders tool/prompt output as formatted JSON or text |
| `DynamicRenderer`   | Recursively renders `ComponentNode` trees            |
| `ComponentRegistry` | Maps URI protocols to React components               |

## Router Integration

```tsx
import { useRouterBridge } from '@frontmcp/react/router';

function App() {
  useRouterBridge(); // Registers NavigateTool, GoBackTool, CurrentRouteResource
  return <Outlet />;
}
```

## AI Integration

```tsx
import { useAITools, useTools, createToolCallHandler } from '@frontmcp/react/ai';
```

## License

Apache-2.0
