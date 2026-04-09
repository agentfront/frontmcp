---
name: tool-custom-spans
reference: telemetry-api
level: basic
description: "Create child spans, events, and attributes inside a tool's execute method using this.telemetry."
tags: [telemetry, tool, spans, events, attributes]
features:
  - 'this.telemetry.withSpan() creates auto-managed child spans'
  - 'this.telemetry.addEvent() adds events to the parent tool span'
  - 'this.telemetry.setAttributes() adds metadata to the parent tool span'
  - 'Child spans inherit the trace ID automatically'
---

# Custom Spans in a Tool

Create child spans, events, and attributes inside a tool's execute method using this.telemetry.

## Code

```typescript
// src/apps/my-app/tools/weather.tool.ts
import { z } from 'zod';

import { Tool, ToolContext } from '@frontmcp/sdk';

@Tool({
  name: 'get_weather',
  description: 'Get weather for a city',
  inputSchema: { city: z.string() },
})
export class GetWeatherTool extends ToolContext {
  async execute({ city }: { city: string }) {
    // Event on the "tool get_weather" span
    this.telemetry.addEvent('request-received', { city });

    // Child span for the API call
    const weather = await this.telemetry.withSpan('fetch-weather-api', async (span) => {
      span.setAttribute('api.city', city);

      const response = await this.fetch(`https://api.weatherapi.com/v1/current.json?q=${city}`);

      span.setAttribute('api.status', response.status);
      span.addEvent('response-received');

      return response.json();
    });

    // Attributes on the tool span (visible in trace backend)
    this.telemetry.setAttributes({
      'weather.temp_c': weather.current.temp_c,
      'weather.condition': weather.current.condition.text,
    });

    return {
      city,
      temperature: weather.current.temp_c,
      condition: weather.current.condition.text,
    };
  }
}
```

## What This Demonstrates

- this.telemetry.withSpan() creates auto-managed child spans
- this.telemetry.addEvent() adds events to the parent tool span
- this.telemetry.setAttributes() adds metadata to the parent tool span
- Child spans inherit the trace ID automatically

## Related

- See `telemetry-api` for all available methods
- See `testing-observability` for testing custom spans
