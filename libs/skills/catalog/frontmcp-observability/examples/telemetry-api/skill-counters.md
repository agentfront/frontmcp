---
name: skill-counters
reference: telemetry-api
level: intermediate
description: Read built-in skill counters from the in-memory snapshot for tests and wire an OTel MeterProvider so counters export to OTLP in production.
tags: [telemetry, counters, metrics, skills, otel, meter-provider]
features:
  - 'this.telemetry.createCounter(name, description) creates a custom counter'
  - 'counter.inc(by, attrs) increments with bounded label cardinality'
  - 'getMetricSnapshot() reads framework counters in tests without a MeterProvider'
  - 'metrics.setGlobalMeterProvider() wires counters into OTLP for production'
---

# Skill Counters and Custom Counters

Read built-in skill counters from the in-memory snapshot for tests and wire an OTel MeterProvider so counters export to OTLP in production.

## Code

```typescript
// src/main.ts — wire a MeterProvider so framework counters export via OTLP
import { metrics } from '@opentelemetry/api';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';

// Now register the FrontMCP server. Built-in skill counters
// (frontmcp_skills_bundle_pulls_total, frontmcp_skills_signature_failures_total, etc.)
// are exported automatically via the global MeterProvider.
import { FrontMcpInstance } from '@frontmcp/sdk';

import config from './server';

const meterProvider = new MeterProvider({
  resource: new Resource({ 'service.name': 'my-mcp-server' }),
  readers: [
    new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({
        url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318/v1/metrics',
      }),
      exportIntervalMillis: 10_000,
    }),
  ],
});

metrics.setGlobalMeterProvider(meterProvider);

await FrontMcpInstance.bootstrap(config);
```

```typescript
// src/tools/process-widget.tool.ts — custom counter inside a tool
import { Tool, ToolContext, z } from '@frontmcp/sdk';

@Tool({
  name: 'process_widget',
  description: 'Process a widget and increment a counter per outcome',
  inputSchema: { id: z.string() },
})
export class ProcessWidgetTool extends ToolContext {
  async execute({ id }: { id: string }) {
    const counter = this.telemetry.createCounter('my_app_widgets_total', 'Widgets processed');
    try {
      const result = await this.handle(id);
      counter.inc(1, { status: 'ok' });
      return result;
    } catch (err) {
      counter.inc(1, { status: 'error' });
      throw err;
    }
  }

  private async handle(id: string): Promise<{ id: string }> {
    return { id };
  }
}
```

```typescript
// __tests__/skill-counters.spec.ts — in-memory snapshot, no MeterProvider needed
import { getMetricSnapshot } from '@frontmcp/observability';

it('records bundle pulls', async () => {
  // ... exercise the server so a bundle gets pulled
  const snapshot = getMetricSnapshot();
  expect(snapshot['frontmcp_skills_bundle_pulls_total']).toBeGreaterThan(0);
});
```

## What This Demonstrates

- this.telemetry.createCounter(name, description) creates a custom counter
- counter.inc(by, attrs) increments with bounded label cardinality
- getMetricSnapshot() reads framework counters in tests without a MeterProvider
- metrics.setGlobalMeterProvider() wires counters into OTLP for production

## Related

- See `telemetry-api` for the full `this.telemetry` reference
- See `vendor-integrations` for vendor-specific OTLP metrics endpoints
