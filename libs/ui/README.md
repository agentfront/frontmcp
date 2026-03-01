# @frontmcp/ui

MUI-based React components, content renderers, and MCP bridge for building interactive MCP widgets.

[![NPM](https://img.shields.io/npm/v/@frontmcp/ui.svg)](https://www.npmjs.com/package/@frontmcp/ui)
[![License](https://img.shields.io/npm/l/@frontmcp/ui.svg)](../../LICENSE)

## Install

```bash
npm install @frontmcp/ui react react-dom @mui/material @emotion/react @emotion/styled
```

> **Note:** Renderer libraries (recharts, react-pdf, mermaid, katex, etc.) are **not** installed locally. They are automatically lazy-loaded from [esm.sh](https://esm.sh) in the browser at runtime.

## Quick Start

### Theme + Components

```tsx
import { FrontMcpThemeProvider } from '@frontmcp/ui/theme';
import { Card, Button, Badge } from '@frontmcp/ui/components';

function App() {
  return (
    <FrontMcpThemeProvider>
      <Card title="Weather" elevation={2}>
        <Badge label="Live" variant="success" />
        <p>Temperature: 18C</p>
        <Button variant="primary" onClick={() => {}}>
          Refresh
        </Button>
      </Card>
    </FrontMcpThemeProvider>
  );
}
```

### MCP Bridge Hooks

```tsx
import { McpBridgeProvider, useCallTool, useToolOutput } from '@frontmcp/ui/react';

function WeatherWidget() {
  const output = useToolOutput<{ temp: number }>();
  const { call, loading } = useCallTool('get_weather');

  return (
    <div>
      <p>{output?.temp}C</p>
      <button onClick={() => call({ city: 'London' })} disabled={loading}>
        Refresh
      </button>
    </div>
  );
}

// Wrap with provider
<McpBridgeProvider>
  <WeatherWidget />
</McpBridgeProvider>;
```

### Content Rendering

```tsx
import { renderContent, detectContentType } from '@frontmcp/ui/renderer';

// Auto-detects content type and renders with the appropriate renderer
const type = detectContentType(data); // 'chart' | 'csv' | 'pdf' | 'mermaid' | ...
const element = renderContent(data, { type });
```

## Features

- **11 MUI components** — Button, Card, Alert, Badge, Avatar, Modal, Table, TextField, Select, List, Loader
- **13 content renderers** — Charts, CSV, Flow, HTML, Image, Maps, Math, MDX, Media (video + audio), Mermaid, PDF, React JSX
- **MCP bridge hooks** — `useCallTool`, `useToolInput`, `useToolOutput`, `useSendMessage`, `useOpenLink`, and more
- **5 platform adapters** — OpenAI, ExtApps, Claude, Gemini, Generic (auto-detected)
- **MUI theme system** — `FrontMcpThemeProvider` with light/dark presets and custom theme support
- **Runtime utilities** — Content type auto-detection, Babel JSX transpilation
- **Tree-shakeable** — Import individual components and renderers to minimize bundle size

## Entry Points

| Path                           | Exports                                                                     |
| ------------------------------ | --------------------------------------------------------------------------- |
| `@frontmcp/ui`                 | Bridge core, hooks (main barrel)                                            |
| `@frontmcp/ui/theme`           | `FrontMcpThemeProvider`, `createFrontMcpTheme`, `defaultTheme`, `darkTheme` |
| `@frontmcp/ui/components`      | All 11 React components                                                     |
| `@frontmcp/ui/components/*`    | Individual components (`/Button`, `/Card`, `/Alert`, etc.)                  |
| `@frontmcp/ui/renderer`        | `renderContent`, `detectContentType`, `registerAllRenderers`                |
| `@frontmcp/ui/renderer/*`      | Individual renderers (`/charts`, `/csv`, `/pdf`, `/mdx`, etc.)              |
| `@frontmcp/ui/renderer/common` | Shared renderer utilities (`useLazyModule`, `useRendererTheme`)             |
| `@frontmcp/ui/react`           | `McpBridgeProvider`, all hooks                                              |
| `@frontmcp/ui/bridge`          | `FrontMcpBridge`, `createBridge`, `AdapterRegistry`, adapters               |
| `@frontmcp/ui/runtime`         | `detectContentType`, `transpileJsx`, Babel loader                           |

## Components

| Component   | Key Props                           | Description                             |
| ----------- | ----------------------------------- | --------------------------------------- |
| `Button`    | `variant`, `onClick`, `disabled`    | MUI button with FrontMCP variants       |
| `Card`      | `title`, `elevation`, `slots`       | Content card with customizable slots    |
| `Alert`     | `severity`, `title`, `onClose`      | Status alert banner                     |
| `Badge`     | `label`, `variant`                  | Status/label badge                      |
| `Avatar`    | `src`, `alt`, `size`                | User avatar                             |
| `Modal`     | `open`, `onClose`, `title`, `slots` | Dialog modal                            |
| `Table`     | `columns`, `rows`, `sortable`       | Data table                              |
| `TextField` | `label`, `value`, `onChange`        | Text input field                        |
| `Select`    | `options`, `value`, `onChange`      | Dropdown select                         |
| `List`      | `items`, `onItemClick`              | List with item definitions              |
| `Loader`    | `variant`, context provider         | Loading indicator with `LoaderProvider` |

## Renderers

| Renderer  | Type              | Priority |
| --------- | ----------------- | -------- |
| PDF       | `pdf`             | 90       |
| Charts    | `chart`           | 80       |
| Flow      | `flow`            | 70       |
| Maps      | `map`             | 60       |
| Mermaid   | `mermaid`         | 50       |
| Math      | `math`            | 40       |
| Image     | `image`           | 30       |
| Media     | `video` / `audio` | 20       |
| CSV       | `csv`             | 10       |
| React JSX | `jsx`             | 10       |
| MDX       | `mdx`             | 5        |
| HTML      | `html`            | 0        |

All renderer libraries are lazy-loaded from [esm.sh](https://esm.sh) in the browser at runtime — no local installation is needed. Priority determines which renderer wins when multiple match.

## Bridge Adapters

| Adapter | Detects Via                           | Priority | Key Capabilities                                |
| ------- | ------------------------------------- | -------- | ----------------------------------------------- |
| OpenAI  | `window.openai.callTool`              | 100      | `callTool`, `sendMessage`, `requestDisplayMode` |
| ExtApps | `window.__mcpPlatform === 'ext-apps'` | 80       | Negotiated via `postMessage` handshake          |
| Claude  | `window.claude`, hostname `claude.ai` | 60       | `openLink`                                      |
| Gemini  | `window.__mcpPlatform === 'gemini'`   | 40       | `openLink`, `networkAccess`                     |
| Generic | Always matches (fallback)             | 0        | `openLink`, `networkAccess`                     |

## Contributing

### Architecture

```mermaid
graph TD
    subgraph "@frontmcp/ui"
        IDX["index.ts<br/><i>Main barrel exports</i>"]

        subgraph bridge["bridge/"]
            B_CORE["core/<br/>AdapterRegistry, bridge factory"]
            B_ADAPT["adapters/<br/>OpenAI, ExtApps, Claude,<br/>Gemini, Generic + base"]
            B_RT["runtime/<br/>Script generation<br/><i>re-exports from uipack</i>"]
            B_TYPES["types/<br/>TypeScript interfaces"]
        end

        subgraph theme["theme/"]
            TH_CREATE["create-theme.ts"]
            TH_PROV["FrontMcpThemeProvider.tsx"]
            TH_HOOK["use-theme.ts"]
        end

        subgraph components["components/ (11)"]
            C_BTN["Button"] --- C_CARD["Card"] --- C_ALERT["Alert"]
            C_BADGE["Badge"] --- C_AVATAR["Avatar"] --- C_MODAL["Modal"]
            C_TABLE["Table"] --- C_TF["TextField"] --- C_SEL["Select"]
            C_LIST["List"] --- C_LOADER["Loader<br/><i>+ LoaderProvider</i>"]
        end

        subgraph renderer["renderer/ (13)"]
            R_CHARTS["charts<br/><i>recharts</i>"]
            R_CSV["csv"]
            R_FLOW["flow<br/><i>@xyflow/react</i>"]
            R_HTML["html<br/><i>dompurify</i>"]
            R_IMG["image"]
            R_MAPS["maps<br/><i>leaflet</i>"]
            R_MATH["math<br/><i>katex</i>"]
            R_MDX["mdx<br/><i>react-markdown</i>"]
            R_MEDIA["media<br/><i>react-player</i>"]
            R_MERM["mermaid"]
            R_PDF["pdf<br/><i>react-pdf</i>"]
            R_REACT["react/jsx"]
            R_COMMON["common/<br/>useLazyModule,<br/>useRendererTheme"]
        end

        subgraph react["react/hooks/"]
            H_CTX["context.ts<br/>McpBridgeProvider,<br/>useMcpBridge, useTheme"]
            H_TOOLS["tools.ts<br/>useCallTool, useToolInput,<br/>useToolOutput"]
        end

        subgraph runtime["runtime/"]
            RT_DETECT["content-detector.ts<br/>detectContentType()"]
            RT_BABEL["babel-runtime.ts<br/>transpileJsx(), loadBabel()"]
        end
    end

    IDX --> bridge
    IDX --> react
    bridge --> B_CORE
    bridge --> B_ADAPT
    bridge --> B_RT
    react --> H_CTX
    react --> H_TOOLS
    H_CTX --> bridge
```

### How @frontmcp/ui works with @frontmcp/uipack

These two packages split concerns between server-side (uipack) and browser-side (ui):

| Concern           | @frontmcp/ui (browser)      | @frontmcp/uipack (server)       |
| ----------------- | --------------------------- | ------------------------------- |
| React dependency  | Yes (peer dep)              | No                              |
| Bridge            | Runtime class + React hooks | IIFE generator (vanilla JS)     |
| Components        | MUI React components        | --                              |
| Shell building    | --                          | HTML shell, CSP, data injection |
| Rendering         | 13 content renderers        | --                              |
| Import resolution | --                          | esm.sh resolver, import maps    |
| Theme             | MUI ThemeProvider           | --                              |

**End-to-end data flow:**

```mermaid
sequenceDiagram
    participant Dev as Developer
    participant SDK as @frontmcp/sdk
    participant UP as @frontmcp/uipack
    participant Browser
    participant UI as @frontmcp/ui

    Dev->>SDK: @Tool({ ui: { npm: '...' } })
    SDK->>UP: renderComponent(config, shellConfig)
    UP->>UP: resolve deps (esm.sh)
    UP->>UP: build shell (CSP + data injection)
    UP->>UP: inject bridge IIFE
    UP-->>SDK: ShellResult { html, hash, size }

    Browser->>SDK: readResource("ui://widget/tool.html")
    SDK-->>Browser: cached HTML

    Browser->>Browser: Load @frontmcp/ui via esm.sh
    Browser->>UI: Mount React components
    UI->>UI: Bridge hooks read window.__mcp* globals
    UI->>Browser: Interactive widget rendered
```

1. **Server-side** (`@frontmcp/uipack`): Resolves component dependencies, builds HTML shell with CSP and bridge IIFE, injects tool data as `window.__mcp*` globals
2. **Browser-side** (`@frontmcp/ui`): Loaded via esm.sh in the browser, provides React components, hooks to read injected data, and the bridge runtime for host communication

### Renderer System

Each renderer implements the `ContentRenderer` interface:

```typescript
interface ContentRenderer {
  type: string; // e.g. 'chart', 'csv', 'pdf'
  priority: number; // Higher wins when multiple match
  canRender(data): boolean;
  render(data, options): ReactElement;
}
```

Renderers are registered via `registerAllRenderers()` and auto-detected at runtime. Each renderer lazy-loads its peer dependencies using `useLazyModule()` — if a peer dep is missing, the renderer gracefully skips.

### Development

```bash
# Build
nx build ui

# Test
nx test ui

# Lint
nx lint ui
```

### Testing

- 95%+ coverage required across statements, branches, functions, lines
- Test all component variants and edge cases
- Test renderer content detection logic
- Test bridge adapter detection and capability checks

## Requirements

- Node.js >= 22.0.0
- React >= 19.0.0
- MUI >= 7.0.0

## Related Packages

- [`@frontmcp/uipack`](../uipack) — React-free server-side shell builder, import resolver, component loader
- [`@frontmcp/sdk`](../sdk) — Core FrontMCP SDK
- [`@frontmcp/testing`](../testing) — UI test assertions

## License

Apache-2.0 — see [LICENSE](../../LICENSE).
