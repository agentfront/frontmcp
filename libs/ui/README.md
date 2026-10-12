# @frontmcp/ui

`@frontmcp/ui` is the React side of FrontMCP widgets: the UI a tool shows inside an AI host such as ChatGPT or Claude. You write a widget as a React component in a file of its own and point the tool's `ui.template` at it; FrontMCP bundles the file, wraps it in `McpBridgeProvider` and mounts it with the call's data. This package gives that component hooks that read the call and call tools through the host, eleven components built on MUI (Material UI), a theme, and renderers for content such as charts, PDFs, maps and diagrams. A widget written as an HTML template doesn't need it ([Tools with a UI](https://frontmcp.dev/learn/tools-with-a-ui)). To make a React app that an agent can drive, use [`@frontmcp/react`](https://www.npmjs.com/package/@frontmcp/react) instead.

[![npm](https://img.shields.io/npm/v/@frontmcp/ui.svg)](https://www.npmjs.com/package/@frontmcp/ui) [![License](https://img.shields.io/npm/l/@frontmcp/ui.svg)](https://github.com/agentfront/frontmcp/blob/main/LICENSE)

## Install

```bash
npm install @frontmcp/ui react react-dom @mui/material @emotion/react @emotion/styled
```

- For widget files, install it in the server's project, even when a widget doesn't import it: the code FrontMCP adds to mount a widget file imports `McpBridgeProvider` from `@frontmcp/ui/react`.
- The required peers are `react` and `react-dom` 18 or 19, `@mui/material` 7, 8 or 9, and `@emotion/react` and `@emotion/styled` 11. npm 7 and later install them with the package, along with `@types/react` and `@types/react-dom`.
- FrontMCP bundles widget files with `esbuild`, an optional peer of `@frontmcp/uipack` that nothing installs for you. A project from `frontmcp create` has it; anywhere else, run `npm install esbuild` and keep it a dependency, not a dev dependency, since it's loaded when the tool is called.
- The server needs Node.js 24 or later.

### Optional peers for the renderers

The renderers' libraries are optional peers, not installed with the package:

| Renderer               | Entry point                                           | Optional peers                                                   |
| ---------------------- | ----------------------------------------------------- | ---------------------------------------------------------------- |
| Charts                 | `@frontmcp/ui/renderer/charts`                        | `recharts`                                                       |
| PDF                    | `@frontmcp/ui/renderer/pdf`                           | `react-pdf`, `pdfjs-dist`                                        |
| Flow diagrams          | `@frontmcp/ui/renderer/flow`                          | `@xyflow/react`                                                  |
| Maps                   | `@frontmcp/ui/renderer/maps`                          | `react-leaflet`, `leaflet`                                       |
| Mermaid diagrams       | `@frontmcp/ui/renderer/mermaid`                       | `mermaid`                                                        |
| Math                   | `@frontmcp/ui/renderer/math`                          | `katex`                                                          |
| Video and audio        | `@frontmcp/ui/renderer/media`                         | `react-player`                                                   |
| Markdown and MDX       | `@frontmcp/ui/renderer/mdx`                           | `react-markdown`, `remark-gfm`, `rehype-highlight`, `rehype-raw` |
| HTML                   | `@frontmcp/ui/renderer/html`                          | `dompurify`; without it the HTML is shown escaped                |
| CSV, images, React JSX | `/renderer/csv`, `/renderer/image`, `/renderer/react` | None. JSX is compiled with Babel, loaded from esm.sh.            |

Each renderer loads its library at runtime, the first time it renders: by package name where the page can resolve it (an installed peer under Node or a dev server, or an import map), and otherwise from [esm.sh](https://esm.sh) in the browser. The stylesheets for maps, math and flow diagrams, and the PDF.js worker, always come from esm.sh.

## Usage

Point the tool's `ui.template` at the widget file with an absolute path:

```ts
import { join } from 'node:path';

import { Tool, ToolContext, z } from '@frontmcp/sdk';

@Tool({
  name: 'get_weather',
  description: 'Current weather for a city',
  inputSchema: { city: z.string() },
  outputSchema: { city: z.string(), tempC: z.number(), conditions: z.string() },
  ui: { template: { file: join(__dirname, 'weather.widget.tsx') } },
})
export class GetWeather extends ToolContext {
  async execute({ city }: { city: string }) {
    return { city, tempC: 21, conditions: 'Sunny' };
  }
}
```

Export the component as the default from `weather.widget.tsx`:

```tsx
import { Badge, Card } from '@frontmcp/ui/components';
import { FrontMcpThemeProvider } from '@frontmcp/ui/theme';

type Weather = { city: string; tempC: number; conditions: string };

export default function WeatherWidget({ output }: { output: Weather | null }) {
  if (!output?.city) return <p>Loading…</p>;
  return (
    <FrontMcpThemeProvider>
      <Card title={output.city} subtitle="Current weather">
        <p>{output.tempC}°C</p>
        <Badge label={output.conditions} variant="success" />
      </Card>
    </FrontMcpThemeProvider>
  );
}
```

The widget gets three props: `output`, `input` and `loading`. Check for a field you need, like `output?.city`, rather than for `output`: a failed result's error text is truthy too. In an ES module server, use `join(import.meta.dirname, 'weather.widget.tsx')`. Name widget files `*.widget.tsx` and leave them out of the server's own `tsc` build; `frontmcp build` copies them into its output. [Building a widget file](https://frontmcp.dev/reference/ui/components#building-a-widget-file) covers relative paths, `resourceMode` and what each host gets.

### Calling a tool from a widget

```tsx
import { useCallTool } from '@frontmcp/ui/react';

type Weather = { city: string; tempC: number };

export default function Refreshable({ output }: { output: Weather | null }) {
  const [refresh, { data, loading, error }] = useCallTool<{ city: string }, Weather>('get_weather');

  const weather = data?.structuredContent ?? (output?.city ? output : null);
  return (
    <div>
      <p>{weather ? `${weather.city}: ${weather.tempC}°C` : 'No data yet'}</p>
      <button disabled={loading} onClick={() => refresh({ city: 'Bergen' })}>
        Bergen
      </button>
      {error && <p role="alert">{error.message}</p>}
    </div>
  );
}
```

`useCallTool()` returns an array, not an object. `call(args)` asks the host to call the tool and resolves with the host's whole result, so the tool's output is in `data.structuredContent`. A tool that fails usually comes back as a result with `isError: true` in `data`; `error` is for calls that couldn't be made, like `Tool calls not supported on this platform (ext-apps)` from a host that never answered the handshake.

### Entry points

| Import                                           | What's in it                                                                                                                                                                                                |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@frontmcp/ui/react`                             | `McpBridgeProvider` and the hooks. `@frontmcp/ui` exports them too, with the bridge.                                                                                                                        |
| `@frontmcp/ui/components`                        | The eleven components. Each also has its own entry point, like `@frontmcp/ui/components/Card`.                                                                                                              |
| `@frontmcp/ui/theme`                             | `FrontMcpThemeProvider`, `createFrontMcpTheme`, `defaultTheme`, `darkTheme`, `useFrontMcpTheme`.                                                                                                            |
| `@frontmcp/ui/renderer`                          | `ContentView`, `renderContent`, `detectContentType`, `registerAllRenderers`, `registerRenderer`, and every renderer. Each renderer also has its own entry point; `/renderer/common` has the shared helpers. |
| `@frontmcp/ui/bridge`                            | The bridge as a class, `FrontMcpBridge` and `createBridge()`, with its adapters and `generateBridgeIIFE()`, for pages FrontMCP doesn't build.                                                               |
| `@frontmcp/ui/runtime`                           | `detectContentType`, and `transpileJsx()` with the Babel loader it uses.                                                                                                                                    |
| `@frontmcp/ui/auth`, `@frontmcp/ui/auth/vanilla` | Components and helpers for a [custom login UI](https://frontmcp.dev/reference/auth/login-ui); the `vanilla` entry has no React.                                                                             |

### Hooks

A widget file is already inside `McpBridgeProvider`. Outside a provider the hooks return empty values, and `call()` fails with `Bridge not initialized`.

| Hook                                      | Returns                                                                                                                   |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `useToolOutput<T>()`                      | The call's output: the output embedded in the page, then each result the host sends.                                      |
| `useToolInput<T>()`                       | The call's arguments.                                                                                                     |
| `useStructuredContent<T>()`               | The `structuredContent` of the result the host sent; empty until one arrives.                                             |
| `useCallTool<In, Out>(name, options?)`    | `[call, { data, loading, error, called }, reset]`. Options: `onSuccess`, `onError`, `resetOnToolChange` (default `true`). |
| `useToolCalls({ key: toolName, ... })`    | `{ key: { call, data, loading, error, reset }, ... }`: `useCallTool` for several tools.                                   |
| `useSendMessage()`                        | `[send(text), { loading, error, sent }]`: adds a message to the conversation, where the host allows it.                   |
| `useOpenLink()`                           | `open(url)`, through the host.                                                                                            |
| `useTheme()`, `useDisplayMode()`          | `"light"` or `"dark"`, and `"inline"`, `"fullscreen"` or `"pip"`, as the host reports them.                               |
| `useHostContext()`                        | What the host said about itself: `{ theme, displayMode, locale, userAgent, safeArea, viewport?, ... }`.                   |
| `useCapability(name)`                     | Whether the host can do `name`, like `"canCallTools"`. `false` until the host answers the handshake.                      |
| `useMcpBridge()`, `useMcpBridgeContext()` | The bridge, and `{ bridge, loading, error, ready, adapterId, capabilities, revision }`.                                   |

### Components

`@frontmcp/ui/components` are React components built on MUI. Put them inside `FrontMcpThemeProvider`.

| Component   | Main props                                                                                      | Renders                                        |
| ----------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `Button`    | `variant` (`primary`, `secondary`, `danger`, `ghost`), `size`, `loading`, `disabled`, `onClick` | An MUI `Button`; `loading` adds a spinner.     |
| `Card`      | `title`, `subtitle`, `headerActions`, `footer`, `elevation`, `clickable`, `slotProps`           | An MUI `Card`.                                 |
| `Alert`     | `severity`, `title`, `dismissible`, `onDismiss`, `icon`                                         | An MUI `Alert`.                                |
| `Badge`     | `label` (required), `variant`, `size`, `dot`, `removable`, `onRemove`                           | An MUI `Chip`.                                 |
| `Avatar`    | `src`, `alt`, `size`, `variant`                                                                 | An MUI `Avatar`.                               |
| `Modal`     | `open` and `onClose` (required), `title`, `actions`, `maxWidth`, `slotProps`                    | An MUI `Dialog`.                               |
| `Table`     | `columns` (`{ key, label, align? }[]`), `rows`, `size`, `stickyHeader`, `maxHeight`             | An MUI `Table`.                                |
| `TextField` | `label`, `value`, `onChange(value)`, `type`, `multiline`, `error`, `helperText`                 | An MUI `TextField`; `onChange` gets the value. |
| `Select`    | `options` (`{ value, label }[]`), `label`, `value`, `onChange(value)`                           | An MUI select field.                           |
| `List`      | `items` (`{ id, primary, secondary?, icon?, onClick?, divider? }[]`), `dense`                   | An MUI `List`.                                 |
| `Loader`    | `variant` (`spinner`, `bar`, `skeleton`, `overlay`), `label`, `determinate`, `value`            | A spinner, progress bar, skeleton or backdrop. |

`LoaderProvider` replaces every `Loader` under it with your own render function. The theme comes from `createFrontMcpTheme({ palette?, typography?, shape?, mode? })`, or the ready-made `defaultTheme` and `darkTheme`, passed to `FrontMcpThemeProvider` as `theme`.

### Renderers

```tsx
import { ContentView, registerAllRenderers } from '@frontmcp/ui/renderer';

registerAllRenderers();

export function Report({ content }: { content: string }) {
  return <ContentView content={content} />;
}
```

`ContentView` detects the kind of content in a string, such as CSV, a Mermaid diagram, a chart's JSON or an image URL, and renders it with the matching renderer, wrapped in `Suspense`. `renderContent(content, options?)` does the same without the `Suspense` boundary, and `detectContentType(content)` only names the kind. When more than one renderer matches, the higher priority wins, in this order: pdf, chart, flow, map, mermaid, math, image, video, audio, csv, jsx, mdx, html. `registerRenderer()` adds your own `{ type, priority?, canHandle(content), render(content, options?) }`.

## Docs

- [Widget components](https://frontmcp.dev/reference/ui/components): building a widget file, the props, hooks, components, theme and renderers
- [Building Widgets with React](https://frontmcp.dev/learn/building-widgets-with-react): the step-by-step guide
- [Tools with a UI](https://frontmcp.dev/learn/tools-with-a-ui): templates or React, and how a widget is served
- [The `ui` option](https://frontmcp.dev/reference/ui): every option of a tool's widget, serving modes, Content Security Policy
- [Hosts and platforms](https://frontmcp.dev/reference/ui/hosts): what each host gets, and the bridge the hooks talk to

## Related packages

- [`@frontmcp/sdk`](https://www.npmjs.com/package/@frontmcp/sdk): the server framework; a tool's `ui` option comes from it.
- [`@frontmcp/uipack`](https://www.npmjs.com/package/@frontmcp/uipack): the React-free core that builds every widget page on the server, with the `html` template helpers.
- [`@frontmcp/testing`](https://www.npmjs.com/package/@frontmcp/testing): test helpers, with matchers for a tool's rendered widget.
- [`@frontmcp/react`](https://www.npmjs.com/package/@frontmcp/react): hooks and components for running a FrontMCP server inside a React app.

## Contributing

Source: [`libs/ui`](https://github.com/agentfront/frontmcp/tree/main/libs/ui). Issues and pull requests are welcome; see [CONTRIBUTING.md](https://github.com/agentfront/frontmcp/blob/main/CONTRIBUTING.md).

The source has one folder per entry point under `src/`: `react/` (provider and hooks), `components/` (one folder per component), `theme/`, `renderer/` (one folder per renderer, plus `common/`), `bridge/` (adapters, the registry and the bridge class), `runtime/` (content detection and the Babel loader) and `auth/`. The bridge script the server puts in each page comes from `@frontmcp/uipack`. In the monorepo:

```bash
nx build ui
nx test ui
nx lint ui
```

## License

Apache-2.0. See [LICENSE](https://github.com/agentfront/frontmcp/blob/main/LICENSE).
