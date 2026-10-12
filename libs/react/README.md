# @frontmcp/react

`@frontmcp/react` runs a FrontMCP server inside a React app. You build the server with `create()`, in the same process, and `FrontMcpProvider` connects a client to it. Components call its tools, read its resources and get its prompts with hooks, and can add tools of their own while they're mounted, so a model can fill in a card, move around the app or read its state. Use it to make a React app something an agent can drive. To build the UI a tool shows inside an AI host such as ChatGPT or Claude, use [`@frontmcp/ui`](https://www.npmjs.com/package/@frontmcp/ui) instead.

[![npm](https://img.shields.io/npm/v/@frontmcp/react.svg)](https://www.npmjs.com/package/@frontmcp/react) [![License](https://img.shields.io/npm/l/@frontmcp/react.svg)](https://github.com/agentfront/frontmcp/blob/main/LICENSE)

## Install

```bash
npm install @frontmcp/react react react-dom
```

- `react` and `react-dom` 18 or 19 are peer dependencies.
- `@frontmcp/sdk` is a peer dependency, at the same version, so the app and this package share one copy: npm 7 and later and pnpm install it for you, and with Yarn add it yourself. `@frontmcp/utils` comes with it. `@frontmcp/react` re-exports what an app needs from the SDK (`create`, `connect` and its variants, the decorators and their function forms, the context classes, and `z`), so you don't import `@frontmcp/sdk` yourself. npm 7 and later also install its peer `@frontmcp/lazy-zod`, and `zod` with it.
- `react-router-dom` 7 is an optional peer, needed only for `@frontmcp/react/router`.
- In the browser, a bundler that follows the `browser` export condition, such as Vite, picks the SDK's browser build ([Running in a browser](https://frontmcp.dev/reference/react#running-in-a-browser)). In Node, for tests or server rendering, use Node.js 24 or later.

## Usage

A tool, the server, and a component that calls it:

```tsx
import { create, FrontMcpProvider, Tool, ToolContext, useCallTool, z } from '@frontmcp/react';

@Tool({ name: 'greet', description: 'Greet someone by name', inputSchema: { name: z.string() } })
class GreetTool extends ToolContext {
  async execute({ name }: { name: string }) {
    return { message: `Hello, ${name}!` };
  }
}

const server = await create({ info: { name: 'my-app', version: '1.0.0' }, tools: [GreetTool] });

function Greeter() {
  const [greet, { data, loading, error }] = useCallTool<{ name: string }, { structuredContent?: { message: string } }>(
    'greet',
  );

  return (
    <div>
      <button disabled={loading} onClick={() => greet({ name: 'Ada' })}>
        Greet
      </button>
      {data?.structuredContent && <p>{data.structuredContent.message}</p>}
      {error && <p role="alert">{error.message}</p>}
    </div>
  );
}

export function App() {
  return (
    <FrontMcpProvider server={server}>
      <Greeter />
    </FrontMcpProvider>
  );
}
```

Clicking the button shows `Hello, Ada!`. `useCallTool()` returns `[call, state, reset]`, and `data` is the MCP result the client got, so the tool's return value is in `data.structuredContent`. A tool that fails comes back as a result with `isError: true` in `data`; `error` is set only when the call couldn't be made, such as `FrontMCP not connected`. Decorators need `"experimentalDecorators": true` in `tsconfig.json`.

### Entry points

| Import                   | What's in it                                                                                                                                                                        |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@frontmcp/react`        | `FrontMcpProvider`, the hooks, the components, `mcpComponent`, `serverRegistry`, `DynamicRegistry` and `bindDynamicTools`, the store adapters, and the SDK re-exports listed above. |
| `@frontmcp/react/state`  | `useStoreResource`, `useReduxResource`, `useValtioResource`: expose a store from inside a component.                                                                                |
| `@frontmcp/react/api`    | `useApiClient`, `parseOpenApiSpec`, `createFetchClient`: register OpenAPI operations as tools.                                                                                      |
| `@frontmcp/react/ai`     | `useAITools`, `useTools`, `createToolCallHandler`: hand the server's tools to an AI SDK.                                                                                            |
| `@frontmcp/react/router` | `useRouterBridge`, `createRouterEntries`, and the `navigate`, `go_back` and `route://current` entries. Needs `react-router-dom` 7.                                                  |

### `FrontMcpProvider`

| Prop              | Default     | Description                                                                                                                 |
| ----------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------- |
| `server`          |             | **Required.** The server from `create()`.                                                                                   |
| `name`            | `"default"` | The server's name in `serverRegistry`, which hooks without a `server` option use.                                           |
| `servers`         |             | More servers, by name. Hooks reach them with `{ server: 'name' }`.                                                          |
| `components`      |             | Components for `DynamicRenderer`, by URI, like `{ 'component://Card': Card }`.                                              |
| `stores`          |             | Store adapters to expose as resources and tools ([Exposing app state](#exposing-app-state)).                                |
| `dynamicToolApps` |             | The app that components' tools join, by server name. Only for a server with several apps.                                   |
| `autoConnect`     | `true`      | Connect on mount. With `false`, call `connect()` from `useFrontMcp()`.                                                      |
| `onConnected`     |             | Called once the client is connected and the lists are loaded.                                                               |
| `onError`         |             | Called when connecting fails, and when the server refuses a tool a component registers. Without it, a refusal is a warning. |

### Hooks

Every hook takes `{ server: 'name' }` to use one of the provider's other `servers`.

| Hook                                       | Returns                                                                                                                                      |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `useFrontMcp(name?)`                       | `{ name, server, client, status, error, tools, resources, resourceTemplates, prompts, registry, connect }`                                   |
| `useCallTool(name, options?)`              | `[call, { data, loading, error, called }, reset]`. Options: `onSuccess`, `onError`, `resetOnToolChange`.                                     |
| `useReadResource(uri, options?)`           | Reads on mount: `{ data, loading, error, refetch }`. Without a URI, `[read, state]` to read on demand.                                       |
| `useGetPrompt(name, options?)`             | `[getPrompt, { data, loading, error }]`                                                                                                      |
| `useListTools()`, `useListPrompts()`       | The server's tools or prompts, kept current.                                                                                                 |
| `useListResources()`                       | `{ resources, resourceTemplates }`                                                                                                           |
| `useStoreResource(uri)`                    | `{ data, loading, error, refetch }` for a `state://` resource, read again whenever the server says it changed.                               |
| `useDynamicTool(options)`                  | Registers a tool while the component is mounted ([below](#giving-the-model-a-tool-from-a-component)).                                        |
| `useDynamicResource(options)`              | Registers a resource, `{ uri, name, description?, mimeType?, read }`, while the component is mounted.                                        |
| `useComponentTree({ rootRef, uri?, ... })` | Registers a resource (`react://component-tree` by default) that describes the DOM under `rootRef`, named by each element's `data-component`. |

### Giving the model a tool from a component

```tsx
import { useDynamicTool, z } from '@frontmcp/react';

export function Cart({ isLoggedIn }: { isLoggedIn: boolean }) {
  useDynamicTool({
    name: 'add_to_cart',
    description: 'Add an item to the shopping cart',
    schema: z.object({ itemId: z.string(), quantity: z.number().optional() }),
    execute: async ({ itemId, quantity }) => {
      addToCart(itemId, quantity ?? 1);
      return { content: [{ type: 'text', text: 'Added to cart' }] };
    },
    enabled: isLoggedIn,
  });

  return <div>Cart</div>;
}
```

The input is checked against `schema` before `execute` runs, and `execute` gets it typed. A raw JSON Schema in `inputSchema` works too. The provider registers the tool with the server as a real tool, through `server.registerTool()`, so its calls run through the server's flow (plugin hooks, authorities, `availableWhen`) and every client sees it, an in-page agent through [`@frontmcp/plugin-webmcp`](https://www.npmjs.com/package/@frontmcp/plugin-webmcp) included. A name the server already has is refused and reported through the provider's `onError`.

### Letting a model show a component

`mcpComponent()` wraps a component so that a model can show it: while it's mounted it registers a tool, and the tool's input, checked against `schema`, becomes the component's props.

```tsx
import { mcpComponent, z } from '@frontmcp/react';

export const WeatherCard = mcpComponent(
  ({ city, temp }) => (
    <div>
      <h2>{city}</h2>
      <p>{temp}°</p>
    </div>
  ),
  {
    name: 'show_weather',
    description: 'Show the weather for a city',
    schema: z.object({ city: z.string(), temp: z.number() }),
    fallback: <p>Waiting for weather data…</p>,
  },
);

// Render it like any component: <WeatherCard />
```

Props you pass yourself, like `<WeatherCard city="Oslo" />`, render right away and are merged over the model's. Call `mcpComponent()` at module level, not inside a component. The first argument can also be a lazy import wrapped in `mcpLazy(() => import('./HeavyChart'))`, or `null` with a `columns` option for a plain table, where the tool takes `{ rows: [...] }`:

```tsx
export const OrderTable = mcpComponent(null, {
  name: 'show_orders',
  description: 'Show a list of orders',
  schema: z.object({ id: z.string(), product: z.string(), price: z.number() }),
  columns: [
    { key: 'id', header: 'Order ID' },
    { key: 'product', header: 'Product' },
    { key: 'price', header: 'Price', render: (value) => `$${value}` },
  ],
});
```

### Components

| Component                              | Description                                                                                    |
| -------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `ToolForm`                             | A form generated from a tool's `inputSchema`. Unstyled, or your own fields with `renderField`. |
| `PromptForm`                           | A form generated from a prompt's arguments.                                                    |
| `ResourceViewer`                       | Shows a read result, `{ contents }`.                                                           |
| `OutputDisplay`                        | Shows a tool or prompt result as text or indented JSON.                                        |
| `DynamicRenderer`, `ComponentRegistry` | Render a tree of `{ type, props?, children? }` nodes with components registered by URI.        |
| `readDomById`, `readDomBySelector`     | Read the page as a resource result, for a resource template.                                   |
| `AgentContent`, `AgentSearch`          | Deprecated: use `mcpComponent()`.                                                              |

### Exposing app state

Each adapter in the provider's `stores` becomes a resource with the whole state (`state://<name>`), a resource per selector (`state://<name>/<selector>`) and a tool per action (`<name>_<action>`):

```tsx
import { createStore, FrontMcpProvider, reduxStore, valtioStore } from '@frontmcp/react';

const stores = [
  reduxStore({
    store: todoStore,
    selectors: { todos: (state) => (state as { todos: unknown[] }).todos },
    actions: { addTodo: (text) => ({ type: 'todos/add', text }) },
  }),
  valtioStore({ proxy: settings, subscribe, paths: { userName: 'user.name' } }),
  createStore({ name: 'counter', getState: getCounter, subscribe: onCounterChange }),
];

export function Root() {
  return (
    <FrontMcpProvider server={server} stores={stores}>
      <App />
    </FrontMcpProvider>
  );
}
```

`reduxStore` names its store `redux` unless you pass `name`, and dispatches what each action creator returns. `valtioStore` defaults to `valtio`; pass it `subscribe` from `valtio/utils`. Keep the `stores` array outside the component. To expose a store only while a component is mounted, use the hooks from `@frontmcp/react/state` with the same options: `useReduxResource()`, `useValtioResource()`, and `useStoreResource()`, which takes `createStore()`'s options. That `useStoreResource()` registers a store; the one from `@frontmcp/react` reads a `state://` resource.

### Registering API operations as tools

```tsx
import { createFetchClient, parseOpenApiSpec, useApiClient } from '@frontmcp/react/api';

const operations = parseOpenApiSpec(openApiDocument);
const client = createFetchClient();

export function ApiTools() {
  useApiClient({ baseUrl: 'https://api.example.com', operations, client });
  return null;
}
```

Each operation becomes a tool named `api_<operationId>` (set `prefix` to change `api`). `client` takes any `HttpClient`, an object with `request({ method, url, headers, body? })`, so you can use axios or a client that adds auth headers.

### Handing the tools to an AI SDK

```tsx
import { useAITools } from '@frontmcp/react/ai';

export function useOpenAITools() {
  const { tools, callTool, loading } = useAITools('openai');
  return { tools, callTool, ready: !loading && tools !== null };
}
```

`tools` is the server's tool list, components' tools included, in the platform's format; `callTool(name, args)` runs a tool and converts its result. `useAITools()` takes `"openai"`, `"claude"`, `"langchain"`, `"vercel-ai"` or `"raw"`. `useTools(platform)`, for `"openai"`, `"claude"` or `"vercel-ai"`, returns `processToolCalls(calls)` instead, which runs a batch of the model's tool calls and returns the messages to send back. Outside React, `createToolCallHandler(server, platform)` gives you the same `callTool`. Keep API keys on a server of your own.

### Letting a model move around the app

Put the router entries into the server, and call `useRouterBridge()` in a component inside both the router and the provider:

```tsx
import { BrowserRouter, Route, Routes } from 'react-router-dom';

import { create, FrontMcpProvider } from '@frontmcp/react';
import { createRouterEntries, useRouterBridge } from '@frontmcp/react/router';

const { tools, resources } = createRouterEntries();
const server = await create({ info: { name: 'my-app', version: '1.0.0' }, tools, resources });

function RouterBridge() {
  useRouterBridge();
  return null;
}

export function App() {
  return (
    <BrowserRouter>
      <FrontMcpProvider server={server}>
        <RouterBridge />
        <Routes>
          <Route path="/home" element={<h1>Home</h1>} />
          <Route path="/settings" element={<h1>Settings</h1>} />
        </Routes>
      </FrontMcpProvider>
    </BrowserRouter>
  );
}
```

The server then has the `navigate` tool (`{ path, replace? }`), the `go_back` tool and the `route://current` resource. `useRouterBridge()` only connects React Router to them; without it mounted, they answer `Router bridge not connected`.

## Docs

- [`@frontmcp/react` reference](https://frontmcp.dev/reference/react): the provider, `serverRegistry`, stores, running in a browser, testing in Node
- [React hooks](https://frontmcp.dev/reference/react/hooks): every hook, including `/state`, `/api` and `/ai`
- [React components](https://frontmcp.dev/reference/react/components): `mcpComponent()`, forms, `DynamicRenderer`, DOM resources, router tools
- [`create()`](https://frontmcp.dev/reference/sdk/create): building the server the provider connects to

## Related packages

- [`@frontmcp/sdk`](https://www.npmjs.com/package/@frontmcp/sdk): the server framework; `create()`, tools, resources and prompts come from it.
- [`@frontmcp/plugin-webmcp`](https://www.npmjs.com/package/@frontmcp/plugin-webmcp): offers the server's tools, components' tools included, to in-browser agents.
- [`@frontmcp/ui`](https://www.npmjs.com/package/@frontmcp/ui): React components and hooks for widgets that render inside an AI host.

## Contributing

Source: [`libs/react`](https://github.com/agentfront/frontmcp/tree/main/libs/react). Issues and pull requests are welcome; see [CONTRIBUTING.md](https://github.com/agentfront/frontmcp/blob/main/CONTRIBUTING.md).

## License

Apache-2.0. See [LICENSE](https://github.com/agentfront/frontmcp/blob/main/LICENSE).
