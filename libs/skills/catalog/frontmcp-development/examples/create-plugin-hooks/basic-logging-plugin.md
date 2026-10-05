---
name: basic-logging-plugin
reference: create-plugin-hooks
level: basic
description: 'Demonstrates a plugin that logs tool execution using `@Will` and `@Did` hook decorators from the pre-built `ToolHook` export.'
tags: [development, plugin-hooks, plugin, hooks, logging]
features:
  - "Using `ToolHook` pre-built export instead of calling `FlowHooksOf('tools:call-tool')` directly"
  - 'Destructuring `Will` and `Did` decorators from the hook object'
  - "Setting `priority: -100` on `@Will` so the logging hook runs before the stage's other `@Will` hooks (lower runs first)"
  - 'Reading the tool name and arguments from `ctx.state.required.input` and logging with `ctx.logger`'
  - 'Registering a plugin in the `plugins` array of `@App`'
---

# Basic Logging Plugin with @Will and @Did

Demonstrates a plugin that logs tool execution using `@Will` and `@Did` hook decorators from the pre-built `ToolHook` export.

## Code

```typescript
// src/plugins/logging.plugin.ts
import { FlowCtxOf, Plugin, ToolHook } from '@frontmcp/sdk';

const { Will, Did } = ToolHook;

@Plugin({ name: 'logging-plugin' })
export class LoggingPlugin {
  @Will('execute', { priority: -100 })
  logBefore(ctx: FlowCtxOf<'tools:call-tool'>) {
    const { name, arguments: toolArguments } = ctx.state.required.input;
    ctx.logger.info(`Tool "${name}" called`, toolArguments);
  }

  @Did('execute')
  logAfter(ctx: FlowCtxOf<'tools:call-tool'>) {
    ctx.logger.info(`Tool "${ctx.state.required.input.name}" completed`);
  }
}
```

```typescript
// src/server.ts
import { App, FrontMcp } from '@frontmcp/sdk';

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
- Setting `priority: -100` on `@Will` so the logging hook runs before the stage's other `@Will` hooks (lower runs first)
- Reading the tool name and arguments from `ctx.state.required.input` and logging with `ctx.logger`
- Registering a plugin in the `plugins` array of `@App`

## Related

- See `create-plugin-hooks` for the full hook decorator API reference
- See `official-plugins` for ready-made plugins that include logging capabilities
