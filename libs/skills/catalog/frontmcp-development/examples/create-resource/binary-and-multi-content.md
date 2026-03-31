---
name: binary-and-multi-content
reference: create-resource
level: advanced
description: 'A resource serving binary blob data and a resource returning multiple content items.'
tags: [development, cli, resource, binary, multi, content]
features:
  - 'Returning binary data as base64-encoded `blob` (not `text`) for images and other binary assets'
  - 'Using `@frontmcp/utils` for file system operations (`readFileBuffer`) instead of `fs` directly'
  - 'Returning multiple content items from a single resource using fragment URIs (`#metrics`, `#charts`)'
  - 'Each content item has its own `uri`, `mimeType`, and `text` or `blob` field'
---

# Binary Content and Multi-Content Resource

A resource serving binary blob data and a resource returning multiple content items.

## Code

```typescript
// src/apps/main/resources/app-logo.resource.ts
import { Resource, ResourceContext } from '@frontmcp/sdk';
import { ReadResourceResult } from '@frontmcp/protocol';

@Resource({
  name: 'app-logo',
  uri: 'assets://logo.png',
  description: 'Application logo image',
  mimeType: 'image/png',
})
class AppLogoResource extends ResourceContext {
  async execute(uri: string, params: Record<string, string>): Promise<ReadResourceResult> {
    const { readFileBuffer } = await import('@frontmcp/utils');
    const buffer = await readFileBuffer('/assets/logo.png');

    return {
      contents: [
        {
          uri,
          mimeType: 'image/png',
          blob: buffer.toString('base64'),
        },
      ],
    };
  }
}
```

```typescript
// src/apps/main/resources/dashboard.resource.ts
import { Resource, ResourceContext } from '@frontmcp/sdk';
import { ReadResourceResult } from '@frontmcp/protocol';

@Resource({
  name: 'dashboard-data',
  uri: 'dashboard://overview',
  description: 'Dashboard overview with metrics and chart data',
  mimeType: 'application/json',
})
class DashboardResource extends ResourceContext {
  async execute(uri: string, params: Record<string, string>): Promise<ReadResourceResult> {
    const metrics = await this.loadMetrics();
    const chartData = await this.loadChartData();

    return {
      contents: [
        {
          uri: `${uri}#metrics`,
          mimeType: 'application/json',
          text: JSON.stringify(metrics),
        },
        {
          uri: `${uri}#charts`,
          mimeType: 'application/json',
          text: JSON.stringify(chartData),
        },
      ],
    };
  }

  private async loadMetrics() {
    return { users: 1500, revenue: 42000 };
  }

  private async loadChartData() {
    return { labels: ['Jan', 'Feb'], values: [100, 200] };
  }
}
```

```typescript
// src/apps/main/index.ts
import { App } from '@frontmcp/sdk';

@App({
  name: 'main',
  resources: [AppLogoResource, DashboardResource],
})
class MainApp {}
```

## What This Demonstrates

- Returning binary data as base64-encoded `blob` (not `text`) for images and other binary assets
- Using `@frontmcp/utils` for file system operations (`readFileBuffer`) instead of `fs` directly
- Returning multiple content items from a single resource using fragment URIs (`#metrics`, `#charts`)
- Each content item has its own `uri`, `mimeType`, and `text` or `blob` field

## Related

- See `create-resource` for function-style builders, simplified return values, and ESM/remote loading
