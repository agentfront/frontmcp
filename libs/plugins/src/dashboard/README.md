# FrontMCP Dashboard Plugin

A visual dashboard plugin for FrontMCP servers that provides real-time visualization and monitoring of your MCP server structure.

## Features

- **Graph Visualization**: Interactive graph showing all tools, resources, prompts, and apps
- **Real-time Updates**: Live connection via MCP protocol over SSE transport
- **CDN-based UI**: UI loaded from CDN (esm.sh) - no bundling required
- **Authentication**: Optional token-based authentication
- **Scope Introspection**: Monitors all scopes in your FrontMCP server

## Installation

The dashboard plugin is included in `@frontmcp/plugins`:

```bash
npm install @frontmcp/plugins
```

## Quick Start

### Using DashboardApp (Recommended)

Add the `DashboardApp` to your FrontMCP server:

```typescript
import { FrontMcp } from '@frontmcp/sdk';
import { DashboardApp } from '@frontmcp/plugins';

@FrontMcp({
  info: { name: 'My Server', version: '1.0.0' },
  apps: [DashboardApp],
})
class MyServer {}
```

Access the dashboard at: `http://localhost:3000/dashboard`

### Using DashboardPlugin (Advanced)

For more control, use the plugin directly:

```typescript
import { FrontMcp } from '@frontmcp/sdk';
import { DashboardPlugin } from '@frontmcp/plugins';

@FrontMcp({
  info: { name: 'My Server', version: '1.0.0' },
  plugins: [
    new DashboardPlugin({
      enabled: true,
      basePath: '/dashboard',
    }),
  ],
})
class MyServer {}
```

## Configuration

### DashboardPluginOptions

| Option           | Type      | Default      | Description                                                              |
| ---------------- | --------- | ------------ | ------------------------------------------------------------------------ |
| `enabled`        | `boolean` | auto         | Enable/disable dashboard. Auto-detects: enabled in dev, disabled in prod |
| `basePath`       | `string`  | `/dashboard` | Base path for dashboard routes                                           |
| `auth.enabled`   | `boolean` | `false`      | Enable token authentication                                              |
| `auth.token`     | `string`  | -            | Secret token for authentication                                          |
| `cdn.entrypoint` | `string`  | -            | Custom CDN URL for external dashboard UI                                 |
| `cdn.react`      | `string`  | esm.sh       | React CDN URL                                                            |
| `cdn.xyflow`     | `string`  | esm.sh       | XYFlow (React Flow) CDN URL                                              |

### Authentication Example

```typescript
import { DashboardPlugin } from '@frontmcp/plugins';

new DashboardPlugin({
  auth: {
    enabled: true,
    token: process.env.DASHBOARD_TOKEN,
  },
});

// Access: http://localhost:3000/dashboard?token=your-secret-token
```

### Custom CDN Example

```typescript
import { DashboardPlugin } from '@frontmcp/plugins';

new DashboardPlugin({
  cdn: {
    entrypoint: 'https://cdn.example.com/frontmcp-dashboard@1.0.0/index.js',
  },
});
```

## Architecture

The dashboard uses a standalone app architecture:

```
┌─────────────────────────────────────────────────────────────────┐
│                    FrontMCP Server                               │
├─────────────────────────────────────────────────────────────────┤
│  Parent Scope              │  Dashboard App (standalone: true)   │
│  ├─ Your tools             │  ├─ /dashboard (HTML)               │
│  ├─ Your resources         │  ├─ /dashboard/sse (SSE transport)  │
│  └─ Your prompts           │  └─ /dashboard/message (MCP)        │
└─────────────────────────────────────────────────────────────────┘
```

### How It Works

1. **HTML Serving**: The dashboard serves an HTML page that loads React and React Flow from CDN
2. **SSE Connection**: The UI connects via SSE to `/dashboard/sse`
3. **MCP Protocol**: The UI calls `dashboard:graph` tool via MCP JSON-RPC to get graph data
4. **Graph Rendering**: React Flow renders the server structure as an interactive graph

## MCP Tools

The dashboard exposes these MCP tools:

### `dashboard:graph`

Get the server graph showing all registered tools, resources, prompts, and apps.

**Input:**

- `includeSchemas` (boolean, default: false): Include full input/output schemas
- `refresh` (boolean, default: false): Force refresh the graph data

**Output:** GraphData object with nodes, edges, and metadata

### `dashboard:list-tools`

List all tools registered in the monitored server.

**Input:**

- `filter` (string, optional): Regex pattern to filter tools by name
- `includeSchemas` (boolean, default: false): Include schemas in response

### `dashboard:list-resources`

List all resources and resource templates.

**Input:**

- `filter` (string, optional): Regex pattern to filter by name or URI
- `includeTemplates` (boolean, default: true): Include resource templates

## Development

### Building

```bash
npx nx build plugins
```

### Testing

```bash
npx nx test plugins
```

## File Structure

```
libs/plugins/src/dashboard/
├── index.ts                     # Barrel exports
├── dashboard.plugin.ts          # Main plugin class
├── dashboard.types.ts           # Zod schemas and types
├── dashboard.symbol.ts          # DI tokens
├── app/
│   └── dashboard.app.ts         # DashboardApp with HTTP middleware
├── providers/
│   └── graph-data.provider.ts   # Extracts graph from all scopes
├── tools/
│   ├── graph.tool.ts            # dashboard:graph tool
│   ├── list-tools.tool.ts       # dashboard:list-tools tool
│   └── list-resources.tool.ts   # dashboard:list-resources tool
├── html/
│   └── html.generator.ts        # Generates dashboard HTML with CDN imports
└── shared/
    └── types.ts                 # GraphData, GraphNode, GraphEdge types
```
