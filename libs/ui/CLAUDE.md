# @frontmcp/ui - Development Guidelines

## Overview

`@frontmcp/ui` provides **MUI-based React components, hooks, content renderers, and MCP bridge** for building interactive MCP widgets.

Shipped to npm and loaded via esm.sh in the browser. Used by developers to build custom MCP resource components.

**Key Principles:**

- MUI (Material UI) components with FrontMCP theming
- React 18/19 support with TypeScript
- Content renderers for JSX, MDX, HTML, PDF, CSV
- MCP bridge hooks for tool communication
- Client-side only (no Node.js native modules)

## Architecture

```text
libs/ui/src/
├── bridge/             # MCP bridge runtime and adapters
├── theme/              # MUI theme system (FrontMcpThemeProvider)
├── components/         # MUI-based React components (FmcpButton, FmcpCard, etc.)
├── renderer/           # Content renderers (mdx, html, react, pdf, csv)
├── react/              # MCP bridge hooks (useCallTool, useToolInput, etc.)
├── runtime/            # Content detection and Babel transpilation
└── index.ts            # Main barrel exports
```

## Import Patterns

```typescript
// Theme
import { FrontMcpThemeProvider, createFrontMcpTheme } from '@frontmcp/ui/theme';

// Components
import { FmcpButton, FmcpCard, FmcpAlert } from '@frontmcp/ui/components';
import { FmcpButton } from '@frontmcp/ui/components/Button';

// Renderer
import { renderContent, detectContentType } from '@frontmcp/ui/renderer';

// Hooks
import { useMcpBridge, useCallTool, useToolInput } from '@frontmcp/ui/react';

// Bridge
import { FrontMcpBridge, createBridge } from '@frontmcp/ui/bridge';
```

## Dependencies

```json
{
  "peerDependencies": {
    "react": "^18.0.0 || ^19.0.0",
    "react-dom": "^18.0.0 || ^19.0.0",
    "@mui/material": "^6.0.0",
    "@emotion/react": "^11.0.0",
    "@emotion/styled": "^11.0.0"
  }
}
```

## Entry Points

| Path                        | Purpose                                |
| --------------------------- | -------------------------------------- |
| `@frontmcp/ui`              | Main exports (bridge, hooks)           |
| `@frontmcp/ui/theme`        | MUI theme provider and config          |
| `@frontmcp/ui/components`   | MUI-based React components             |
| `@frontmcp/ui/components/*` | Individual components (tree-shakeable) |
| `@frontmcp/ui/renderer`     | Content renderers (auto-detect)        |
| `@frontmcp/ui/renderer/*`   | Individual renderers                   |
| `@frontmcp/ui/react`        | MCP bridge hooks                       |
| `@frontmcp/ui/bridge`       | MCP bridge adapters                    |
| `@frontmcp/ui/runtime`      | Content detection, Babel runtime       |

## Related Packages

- **@frontmcp/uipack** - Server-side template processor (pure TS, no Node.js)
- **@frontmcp/sdk** - Core FrontMCP SDK
