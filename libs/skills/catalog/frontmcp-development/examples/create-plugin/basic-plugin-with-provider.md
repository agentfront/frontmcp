---
name: basic-plugin-with-provider
reference: create-plugin
level: basic
description: 'A minimal plugin that contributes an injectable service via the `providers` and `exports` arrays.'
tags: [development, plugin, provider]
features:
  - 'Creating a plugin with `@Plugin` decorator that bundles a `@Provider` class'
  - 'Listing providers in both `providers` (for DI registration) and `exports` (for external access)'
  - 'Registering a plugin in the `plugins` array of `@FrontMcp`'
---

# Basic Plugin with a Provider

A minimal plugin that contributes an injectable service via the `providers` and `exports` arrays.

## Code

```typescript
// src/plugins/audit-log/providers/audit-logger.provider.ts
import { Provider } from '@frontmcp/sdk';

@Provider()
export class AuditLogger {
  async logToolCall(toolName: string, userId: string, input: unknown): Promise<void> {
    console.log(`[AUDIT] ${userId} called ${toolName}`, input);
  }
}
```

```typescript
// src/plugins/audit-log/audit-log.plugin.ts
import { Plugin } from '@frontmcp/sdk';
import { AuditLogger } from './providers/audit-logger.provider';

@Plugin({
  name: 'audit-log',
  description: 'Logs tool executions for audit compliance',
  providers: [AuditLogger],
  exports: [AuditLogger],
})
export default class AuditLogPlugin {}
```

```typescript
// src/server.ts
import { FrontMcp, App } from '@frontmcp/sdk';
import AuditLogPlugin from './plugins/audit-log/audit-log.plugin';

@App({ name: 'MyApp' })
class MyApp {}

@FrontMcp({
  info: { name: 'my-server', version: '1.0.0' },
  apps: [MyApp],
  plugins: [AuditLogPlugin],
})
class MyServer {}
```

## What This Demonstrates

- Creating a plugin with `@Plugin` decorator that bundles a `@Provider` class
- Listing providers in both `providers` (for DI registration) and `exports` (for external access)
- Registering a plugin in the `plugins` array of `@FrontMcp`

## Related

- See `create-plugin` for context extensions, DynamicPlugin, and metadata augmentation
