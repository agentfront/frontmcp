---
name: plugin-telemetry
reference: telemetry-api
level: intermediate
description: "Add telemetry events from a custom plugin's hooks. Events appear on the tool execution span, giving you visibility into plugin behavior within the trace."
tags: [telemetry, plugin, hooks, cache, audit]
features:
  - 'Plugin hooks can access toolCtx.telemetry to add events to the active span'
  - 'Events from plugins appear in the same trace as the tool execution'
  - "One `@ToolHook.Around('execute')` hook records success and failure: the flow state has no `error` key, and a `Did` hook runs only after a successful execute"
  - 'Graceful degradation when observability is not enabled'
---

# Plugin Telemetry

Add telemetry events from a custom plugin's hooks. Events appear on the tool execution span, giving you visibility into plugin behavior within the trace.

## Code

```typescript
// src/plugins/audit.plugin.ts
import { DynamicPlugin, FlowCtxOf, Plugin, ToolHook } from '@frontmcp/sdk';

import type {} from '@frontmcp/observability'; // declares toolContext.telemetry

@Plugin({
  name: 'audit',
  description: 'Audit logging with telemetry integration',
  providers: [],
})
export default class AuditPlugin extends DynamicPlugin<{ enabled: boolean }> {
  // One Around hook sees both outcomes: a Did hook runs only after a successful execute
  @ToolHook.Around('execute')
  async auditExecution(flowCtx: FlowCtxOf<'tools:call-tool'>, next: () => Promise<void>): Promise<void> {
    const toolCtx = flowCtx.state.required.toolContext;

    // Add audit event to the tool's execution span
    this.addAuditEvent(flowCtx, 'audit.pre-execution', {
      tool: flowCtx.state.required.input.name,
      user: toolCtx.authInfo.clientId ?? 'anonymous',
    });

    try {
      await next();
      this.addAuditEvent(flowCtx, 'audit.post-execution', { success: true });
    } catch (error) {
      this.addAuditEvent(flowCtx, 'audit.post-execution', { success: false });
      throw error;
    }
  }

  private addAuditEvent(
    flowCtx: FlowCtxOf<'tools:call-tool'>,
    name: string,
    attributes: Record<string, string | boolean>,
  ): void {
    try {
      flowCtx.state.required.toolContext.telemetry.addEvent(name, attributes);
    } catch {
      // telemetry throws when observability is not installed or tracing is disabled
    }
  }
}
```

```typescript
// src/server.ts
import { FrontMcp } from '@frontmcp/sdk';

import { MyApp } from './my.app';
import AuditPlugin from './plugins/audit.plugin';

@FrontMcp({
  info: { name: 'my-server', version: '1.0.0' },
  apps: [MyApp],
  plugins: [AuditPlugin.init({ enabled: true })],
  observability: true,
})
export default class Server {}
```

Result in the trace:

```
tool my_tool
  ├── event: audit.pre-execution (tool=my_tool, user=client-42)
  ├── event: stage.execute.start
  ├── ... tool work ...
  ├── event: stage.execute.done
  └── event: audit.post-execution (success=true)
```

## What This Demonstrates

- Plugin hooks can access toolCtx.telemetry to add events to the active span
- Events from plugins appear in the same trace as the tool execution
- One `@ToolHook.Around('execute')` hook records success and failure: the flow state has no `error` key, and a `Did` hook runs only after a successful execute
- Graceful degradation when observability is not enabled

## Related

- See `telemetry-api` for all TelemetryAccessor methods
- See `frontmcp-extensibility` for building plugins
