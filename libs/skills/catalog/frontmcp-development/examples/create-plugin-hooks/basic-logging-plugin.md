---
name: basic-logging-plugin
reference: create-plugin-hooks
level: basic
description: 'Demonstrates a plugin that logs tool execution using `@Will` and `@Did` hook decorators from the pre-built `ToolHook` export.'
tags: [development, plugin-hooks, plugin, hooks, logging]
features:
  - "Using `ToolHook` pre-built export instead of calling `FlowHooksOf('tools:call-tool')` directly"
  - 'Destructuring `Will` and `Did` decorators from the hook object'
  - 'Setting `priority: 100` on `@Will` to ensure the logging hook runs early'
  - 'Registering a plugin in the `plugins` array of `@App`'
---

# Basic Logging Plugin with @Will and @Did

Demonstrates a plugin that logs tool execution using `@Will` and `@Did` hook decorators from the pre-built `ToolHook` export.

## Code

```typescript
// src/plugins/logging.plugin.ts
import { Plugin } from '@frontmcp/sdk';
import { ToolHook } from '@frontmcp/sdk';

const { Will, Did } = ToolHook;

@Plugin({ name: 'logging-plugin' })
export class LoggingPlugin {
  @Will('execute', { priority: 100 })
  logBefore(ctx) {
    console.log(`[LOG] Tool "${ctx.toolName}" called with`, ctx.input);
  }

  @Did('execute')
  logAfter(ctx) {
    console.log(`[LOG] Tool "${ctx.toolName}" completed in ${ctx.elapsed()}ms`);
  }
}
```

```typescript
// src/server.ts
import { FrontMcp, App } from '@frontmcp/sdk';
import { LoggingPlugin } from './plugins/logging.plugin';

@App({
  name: 'my-app',
  plugins: [LoggingPlugin],
})
class MyApp {}

@FrontMcp({
  info: { name: 'my-server', version: '1.0.0' },
  apps: [MyApp],
})
class MyServer {}
```

## What This Demonstrates

- Using `ToolHook` pre-built export instead of calling `FlowHooksOf('tools:call-tool')` directly
- Destructuring `Will` and `Did` decorators from the hook object
- Setting `priority: 100` on `@Will` to ensure the logging hook runs early
- Registering a plugin in the `plugins` array of `@App`

## Related

- See `create-plugin-hooks` for the full hook decorator API reference
- See `official-plugins` for ready-made plugins that include logging capabilities
