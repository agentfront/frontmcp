---
name: weather-tool-with-schemas
reference: example-weather-api
level: basic
description: 'Shows how to create a tool with Zod input and output schemas, use `this.fetch()` for HTTP calls, and handle errors with `this.fail()`.'
tags: [guides, weather, api, tool, schemas]
features:
  - 'Defining Zod `inputSchema` with validation (`.min(1)`, `.enum()`, `.default()`)'
  - 'Defining `outputSchema` to prevent data leaks and ensure type safety'
  - 'Using `this.fetch()` for HTTP calls within tools'
  - 'Using `this.fail()` for business-logic error handling'
  - 'Using `.describe()` on schema fields for LLM-friendly tool descriptions'
---

# Weather Tool with Zod Input/Output Schemas

Shows how to create a tool with Zod input and output schemas, use `this.fetch()` for HTTP calls, and handle errors with `this.fail()`.

## Code

```typescript
// src/tools/get-weather.tool.ts
import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

@Tool({
  name: 'get_weather',
  description: 'Get current weather for a city',
  inputSchema: {
    city: z.string().min(1).describe('City name'),
    units: z.enum(['celsius', 'fahrenheit']).default('celsius').describe('Temperature units'),
  },
  outputSchema: {
    temperature: z.number(),
    condition: z.string(),
    humidity: z.number(),
    city: z.string(),
  },
})
export class GetWeatherTool extends ToolContext {
  async execute(input: { city: string; units: 'celsius' | 'fahrenheit' }) {
    const url = `https://api.weather.example.com/v1/current?city=${encodeURIComponent(input.city)}&units=${input.units}`;

    // Use this.fetch() for HTTP calls — the framework handles errors in the tool execution flow.
    const response = await this.fetch(url);

    if (!response.ok) {
      // Use this.fail() for business-logic errors
      this.fail(new Error(`Weather API error: ${response.status} ${response.statusText}`));
    }

    const data = await response.json();

    return {
      temperature: data.temp,
      condition: data.condition,
      humidity: data.humidity,
      city: input.city,
    };
  }
}
```

## What This Demonstrates

- Defining Zod `inputSchema` with validation (`.min(1)`, `.enum()`, `.default()`)
- Defining `outputSchema` to prevent data leaks and ensure type safety
- Using `this.fetch()` for HTTP calls within tools
- Using `this.fail()` for business-logic error handling
- Using `.describe()` on schema fields for LLM-friendly tool descriptions

## Related

- See `example-weather-api` for the full end-to-end weather API example with tests
