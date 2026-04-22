---
name: minimal-provider
reference: contribute-api
level: basic
description: 'Shows the smallest possible CloudProvider — a named export with `name` and a sync `contribute()` that returns a single plugin, plus the matching package.json for npm publishing.'
tags: [cloud, contribute, minimal, plugin, packaging]
features:
  - 'Exporting `cloudProvider` as a named export from the package entry'
  - 'Returning a `CloudContributions` object with a single `plugins` entry from a sync `contribute()`'
  - 'Validating required options inside `contribute()` and throwing for missing fields'
  - 'Omitting `bootstrap()` when the provider has no remote runtime work'
  - 'Declaring `@frontmcp/sdk` in `peerDependencies` so host and plugin share the same SDK version'
---

# Minimal CloudProvider

Shows the smallest possible CloudProvider — a named export with `name` and a sync `contribute()` that returns a single plugin, plus the matching package.json for npm publishing.

## Code

```typescript
// src/your-cloud.provider.ts
import type { CloudContributions, CloudOptions, CloudProvider } from '@frontmcp/sdk';

import YourCloudPlugin from './your-cloud.plugin.js';

export const cloudProvider: CloudProvider = {
  name: 'yourcloud',

  contribute(options: CloudOptions): CloudContributions {
    if (!options.clientId) {
      throw new Error('[yourcloud] clientId is required');
    }
    return {
      plugins: [YourCloudPlugin.init(options)],
    };
  },
};
```

```typescript
// src/index.ts — the package entry
// The SDK looks for EXACTLY this named export.
export { cloudProvider } from './your-cloud.provider.js';
export { default as YourCloudPlugin } from './your-cloud.plugin.js';
```

```typescript
// src/your-cloud.plugin.ts
import { DynamicPlugin, Plugin, type CloudOptions, type ProviderType } from '@frontmcp/sdk';

import { YourCloudConfigToken } from './tokens.js';

@Plugin({ name: 'yourcloud' })
export default class YourCloudPlugin extends DynamicPlugin<CloudOptions> {
  constructor(public readonly options: CloudOptions) {
    super();
  }

  static override dynamicProviders = (options: CloudOptions): ProviderType[] => [
    { name: 'yourcloud:config', provide: YourCloudConfigToken, useValue: options },
  ];
}
```

```json
{
  "name": "@your-org/plugin-yourcloud",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "default": "./dist/index.js"
    }
  },
  "publishConfig": { "access": "public" },
  "peerDependencies": { "@frontmcp/sdk": ">=1.2.0" }
}
```

## How the customer consumes it

```bash
npm install @your-org/plugin-yourcloud
```

```typescript
import { FrontMcp, FrontMcpInstance } from '@frontmcp/sdk';

@FrontMcp({
  info: { name: 'my-server', version: '1.0.0' },
  apps: [],
  cloud: {
    clientId: process.env.YOURCLOUD_CLIENT_ID!,
    secret: process.env.YOURCLOUD_SECRET!,
  },
})
class Server {}

FrontMcpInstance.bootstrap(Server);
```

## What This Demonstrates

- Exporting `cloudProvider` as a named export from the package entry
- Returning a `CloudContributions` object with a single `plugins` entry from a sync `contribute()`
- Validating required options inside `contribute()` and throwing for missing fields
- Omitting `bootstrap()` when the provider has no remote runtime work
- Declaring `@frontmcp/sdk` in `peerDependencies` so host and plugin share the same SDK version

## Related

- See `contribute-api` for the full `CloudContributions` shape
- See `packaging` for npm layout details
- See `full-lifecycle` for a provider that also implements `bootstrap()`
