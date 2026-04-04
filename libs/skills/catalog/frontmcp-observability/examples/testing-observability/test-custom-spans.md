---
name: test-custom-spans
reference: testing-observability
level: basic
description: 'Verify that your tool creates the expected child spans with correct attributes.'
tags: [testing, spans, assertions, jest, basic]
features:
  - 'createTestTracer() provides isolated OTel setup (no global pollution)'
  - 'assertSpanExists() throws helpful errors when spans are missing'
  - 'assertSpanAttribute() verifies span attributes'
  - 'findSpansByAttribute() queries spans by attribute value'
---

# Test Custom Spans

Verify that your tool creates the expected child spans with correct attributes.

## Code

```typescript
// src/apps/my-app/tools/__tests__/weather.tool.spec.ts
import { SpanStatusCode } from '@opentelemetry/api';
import {
  createTestTracer,
  getFinishedSpans,
  assertSpanExists,
  assertSpanAttribute,
  findSpansByAttribute,
} from '@frontmcp/observability';

describe('GetWeatherTool', () => {
  const { tracer, exporter, cleanup } = createTestTracer();

  afterEach(() => {
    exporter.reset();
  });

  afterAll(async () => {
    await cleanup();
  });

  it('should create a fetch-weather-api child span', async () => {
    // ... set up and invoke tool ...
    // (the tool uses this.telemetry.withSpan('fetch-weather-api', ...))

    const spans = getFinishedSpans(exporter);

    // Verify span exists
    const fetchSpan = assertSpanExists(spans, 'fetch-weather-api');

    // Verify attributes
    assertSpanAttribute(fetchSpan, 'api.city', 'London');
    assertSpanAttribute(fetchSpan, 'api.status', 200);

    // Verify it completed successfully
    expect(fetchSpan.status.code).toBe(SpanStatusCode.OK);
  });

  it('should record error when API fails', async () => {
    // ... invoke tool with failing API ...

    const spans = getFinishedSpans(exporter);
    const fetchSpan = assertSpanExists(spans, 'fetch-weather-api');

    expect(fetchSpan.status.code).toBe(SpanStatusCode.ERROR);
    expect(fetchSpan.events.some((e) => e.name === 'exception')).toBe(true);
  });

  it('should find all tool spans', async () => {
    // ... invoke multiple tools ...

    const spans = getFinishedSpans(exporter);
    const toolSpans = findSpansByAttribute(spans, 'mcp.component.type', 'tool');

    expect(toolSpans.length).toBeGreaterThan(0);
  });
});
```

## What This Demonstrates

- createTestTracer() provides isolated OTel setup (no global pollution)
- assertSpanExists() throws helpful errors when spans are missing
- assertSpanAttribute() verifies span attributes
- findSpansByAttribute() queries spans by attribute value

## Related

- See `testing-observability` for log entry testing
- See `frontmcp-testing` for general testing patterns
