---
name: telemetry-api
description: 'Use this.telemetry in tools, plugins, and agents to create custom spans, events, and attributes.'
tags: [telemetry, api, spans, events, attributes, this-telemetry, custom]
---

# Telemetry API (`this.telemetry`)

Every execution context (tools, resources, prompts, agents) gets a `this.telemetry` API when observability is enabled. No imports, no context construction — it automatically inherits the current request's trace ID, session ID, and scope.

## Available Methods

| Method                       | Purpose                                             |
| ---------------------------- | --------------------------------------------------- |
| `startSpan(name, attrs?)`    | Create a child span (you must call `.end()`)        |
| `withSpan(name, fn, attrs?)` | Run a function in an auto-managed span              |
| `addEvent(name, attrs?)`     | Add an event to the active execution span           |
| `setAttributes(attrs)`       | Set attributes on the active execution span         |
| `traceId`                    | Get the current trace ID (for external correlation) |
| `sessionId`                  | Get the privacy-safe session tracing ID             |

## Usage in Tools

```typescript
import { Tool, ToolContext, z } from '@frontmcp/sdk';

@Tool({
  name: 'analyze_data',
  description: 'Analyze dataset with custom telemetry',
  inputSchema: { datasetId: z.string() },
})
class AnalyzeDataTool extends ToolContext {
  async execute({ datasetId }: { datasetId: string }) {
    // Events go on the "tool analyze_data" span
    this.telemetry.addEvent('analysis-started', { datasetId });

    // Child span for a specific operation
    const data = await this.telemetry.withSpan('fetch-dataset', async (span) => {
      span.setAttribute('dataset.id', datasetId);
      const res = await this.fetch(`/api/datasets/${datasetId}`);
      span.addEvent('data-received', { rows: res.headers.get('x-total-count') ?? '0' });
      return res.json();
    });

    // Attributes on the execution span
    this.telemetry.setAttributes({ 'dataset.size': data.length });

    // Another child span
    const result = await this.telemetry.withSpan('run-analysis', async (span) => {
      const analysis = this.get(AnalysisService).run(data);
      span.setAttribute('result.score', analysis.score);
      return analysis;
    });

    return { score: result.score, datasetId };
  }
}
```

Result in the trace:

```
tool analyze_data
  ├── event: analysis-started
  ├── attribute: dataset.size = 1500
  │
  ├── fetch-dataset (child span)
  │     ├── attribute: dataset.id = "ds-123"
  │     └── event: data-received
  │
  └── run-analysis (child span)
        └── attribute: result.score = 0.95
```

## Usage in Plugins

External plugins use the same `this.telemetry` API. Events appear on the parent tool/resource span:

```typescript
@Plugin({ name: 'my-audit-plugin', contextExtensions: [...] })
class AuditPlugin extends DynamicPlugin<AuditOptions> {
  @ToolHook.Will('execute')
  willExecute(flowCtx: FlowCtxOf<'tools:call-tool'>): void {
    const toolCtx = flowCtx.state.toolContext;
    if (toolCtx?.telemetry) {
      toolCtx.telemetry.addEvent('audit.pre-check', { policy: 'strict' });
    }
  }
}
```

## Usage in Agents

Agents have the same API. Nested tool calls automatically share the trace ID:

```typescript
@Agent({ name: 'research-agent', tools: [WebSearchTool, SummarizerTool] })
class ResearchAgent extends AgentContext {
  async execute(input: { query: string }) {
    this.telemetry.addEvent('research-started', { query: input.query });
    // Nested tool calls get their own spans under the agent span
    return super.execute(input);
  }
}
```

## Manual Span Management

For operations where you need explicit control:

```typescript
const span = this.telemetry.startSpan('complex-operation', {
  'operation.type': 'batch-import',
  'batch.size': items.length,
});

try {
  for (const item of items) {
    await processItem(item);
    span.addEvent('item-processed', { itemId: item.id });
  }
  span.end();
} catch (err) {
  span.recordError(err);
  span.endWithError(err);
  throw err;
}
```

## Access to Raw OTel Span

For advanced use cases, access the underlying OTel Span:

```typescript
const telemetrySpan = this.telemetry.startSpan('advanced-op');
const otelSpan = telemetrySpan.raw; // @opentelemetry/api Span
otelSpan.setAttributes({ 'custom.otel.attr': 'value' });
telemetrySpan.end();
```

## Examples

| Example                                                                     | Level        | Description                                                                                                                                               |
| --------------------------------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`tool-custom-spans`](../examples/telemetry-api/tool-custom-spans.md)       | Basic        | Create child spans, events, and attributes inside a tool's execute method using this.telemetry.                                                           |
| [`plugin-telemetry`](../examples/telemetry-api/plugin-telemetry.md)         | Intermediate | Add telemetry events from a custom plugin's hooks. Events appear on the tool execution span, giving you visibility into plugin behavior within the trace. |
| [`agent-nested-tracing`](../examples/telemetry-api/agent-nested-tracing.md) | Advanced     | Trace an agent's execution lifecycle including its nested tool calls. Every span shares the same trace ID.                                                |

> See all examples in [`examples/telemetry-api/`](../examples/telemetry-api/)

## Reference

- [Telemetry API Reference](https://docs.agentfront.dev/frontmcp/sdk-reference/telemetry)
- Related skills: `frontmcp-development`, `frontmcp-extensibility`
