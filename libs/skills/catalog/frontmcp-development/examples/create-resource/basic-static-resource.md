---
name: basic-static-resource
reference: create-resource
level: basic
description: 'A static resource that exposes application configuration at a fixed URI.'
tags: [development, resource, static]
features:
  - 'Using `@Resource` with a fixed URI that follows RFC 3986 (has a valid scheme)'
  - 'Returning a `ReadResourceResult` with `contents` array containing `uri`, `mimeType`, and `text`'
  - 'Setting `mimeType` to indicate the content type of the resource'
  - 'Registering the resource in the `resources` array of `@App`'
---

# Basic Static Resource

A static resource that exposes application configuration at a fixed URI.

## Code

```typescript
// src/apps/main/resources/app-config.resource.ts
import { Resource, ResourceContext } from '@frontmcp/sdk';
import { ReadResourceResult } from '@frontmcp/protocol';

@Resource({
  name: 'app-config',
  uri: 'config://app/settings',
  description: 'Current application configuration',
  mimeType: 'application/json',
})
class AppConfigResource extends ResourceContext {
  async execute(uri: string, params: Record<string, string>): Promise<ReadResourceResult> {
    const config = {
      version: '2.1.0',
      environment: 'production',
      features: { darkMode: true, notifications: true },
    };

    return {
      contents: [
        {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify(config, null, 2),
        },
      ],
    };
  }
}
```

```typescript
// src/apps/main/index.ts
import { App } from '@frontmcp/sdk';

@App({
  name: 'main',
  resources: [AppConfigResource],
})
class MainApp {}
```

## What This Demonstrates

- Using `@Resource` with a fixed URI that follows RFC 3986 (has a valid scheme)
- Returning a `ReadResourceResult` with `contents` array containing `uri`, `mimeType`, and `text`
- Setting `mimeType` to indicate the content type of the resource
- Registering the resource in the `resources` array of `@App`

## Related

- See `create-resource` for resource templates, binary content, and function-style builders
