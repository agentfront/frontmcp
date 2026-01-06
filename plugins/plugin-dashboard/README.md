# @frontmcp/plugin-dashboard

Dashboard plugin for FrontMCP - provides visual monitoring and introspection of MCP servers.

## Installation

```bash
npm install @frontmcp/plugin-dashboard
```

## Usage

```typescript
import { DashboardPlugin } from '@frontmcp/plugin-dashboard';
import { FrontMcp } from '@frontmcp/sdk';

const app = new FrontMcp({
  plugins: [DashboardPlugin],
});
```

## Features

- **Visual Dashboard**: Web-based UI for monitoring MCP servers
- **Graph Visualization**: View tools, resources, and their relationships
- **Introspection Tools**: Built-in tools to list and describe server capabilities
- **Real-time Updates**: Monitor server state in real-time

## Configuration

```typescript
import { DashboardPlugin } from '@frontmcp/plugin-dashboard';

const app = new FrontMcp({
  plugins: [
    DashboardPlugin.configure({
      basePath: '/dashboard',
      enableTools: true,
    }),
  ],
});
```

## License

Apache-2.0
