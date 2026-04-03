---
name: plugin-telemetry
reference: telemetry-api
level: intermediate
description: "Add telemetry events from a custom plugin's hooks. Events appear on the tool execution span, giving you visibility into plugin behavior within the trace."
tags: [telemetry, plugin, hooks, cache, audit]
features:
  - 'Plugin hooks can access toolCtx.telemetry to add events to the active span'
  - 'Events from plugins appear in the same trace as the tool execution'
  - 'Graceful degradation when observability is not enabled'
---

# Plugin Telemetry

Add telemetry events from a custom plugin's hooks. Events appear on the tool execution span, giving you visibility into plugin behavior within the trace.

## Code

```typescript
// src/plugins/audit.plugin.ts
import { DynamicPlugin, Plugin, ToolHook, FlowCtxOf } from '@frontmcp/sdk';

@Plugin({
  name: 'audit',
  description: 'Audit logging with telemetry integration',
  providers: [],
})
export default class AuditPlugin extends DynamicPlugin<{ enabled: boolean }> {
  @ToolHook.Will('execute')
  willExecute(flowCtx: FlowCtxOf<'tools:call-tool'>): void {
    const toolCtx = flowCtx.state.toolContext;
    if (!toolCtx) return;

    // Add audit event to the tool's execution span
    try {
      toolCtx.telemetry?.addEvent('audit.pre-execution', {
        tool: flowCtx.state.input?.name ?? 'unknown',
        user: toolCtx.context?.authInfo?.clientId ?? 'anonymous',
      });
    } catch {
      // telemetry may not be available if observability is disabled
    }
  }

  @ToolHook.Did('execute')
  didExecute(flowCtx: FlowCtxOf<'tools:call-tool'>): void {
    const toolCtx = flowCtx.state.toolContext;
    if (!toolCtx) return;

    try {
      toolCtx.telemetry?.addEvent('audit.post-execution', {
        success: !flowCtx.state.error,
      });
    } catch {
      // graceful degradation
    }
  }
}
```

```typescript
// src/server.ts
import { FrontMcp } from '@frontmcp/sdk';
import AuditPlugin from './plugins/audit.plugin';

@FrontMcp({
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
- Graceful degradation when observability is not enabled

## Related

- See `telemetry-api` for all TelemetryAccessor methods
- See `frontmcp-extensibility` for building plugins
