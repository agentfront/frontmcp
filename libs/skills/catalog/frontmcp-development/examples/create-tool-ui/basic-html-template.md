---
name: basic-html-template
reference: create-tool-ui
level: basic
description: 'A minimal function template that renders the tool output as a styled HTML card using `ctx.helpers.escapeHtml`.'
tags: [development, tool, ui, widget, mcp-apps, html, basic]
features:
  - 'Adding `ui:` to `@Tool({...})` with a function template `(ctx) => string`'
  - 'Reading `ctx.input`, `ctx.output`, and `ctx.helpers` from the typed `TemplateContext`'
  - 'Escaping user-controlled strings via `ctx.helpers.escapeHtml(...)`'
  - 'Letting `servingMode` default to `auto` so the SDK picks the right mode per host (OpenAI vs Claude vs no-UI)'
  - 'Surfacing `widgetDescription` for the host UI'
---

# Basic HTML Widget (Function Template)

A minimal function template that renders the tool output as a styled HTML card using `ctx.helpers.escapeHtml`.

## Code

```typescript
// src/apps/main/tools/get-weather.schema.ts
import { ToolInputOf, ToolOutputOf, z } from '@frontmcp/sdk';

export const inputSchema = {
  location: z.string().describe('City name'),
};

export const outputSchema = {
  location: z.string(),
  temperatureF: z.number(),
  conditions: z.string(),
  humidityPct: z.number(),
};

export type GetWeatherInput = ToolInputOf<{ inputSchema: typeof inputSchema }>;
export type GetWeatherOutput = ToolOutputOf<{ outputSchema: typeof outputSchema }>;
```

```typescript
// src/apps/main/tools/get-weather.tool.ts
import { Tool, ToolContext } from '@frontmcp/sdk';

import { inputSchema, outputSchema, type GetWeatherInput, type GetWeatherOutput } from './get-weather.schema';

@Tool({
  name: 'get_weather',
  description: 'Get current weather for a location',
  inputSchema,
  outputSchema,
  ui: {
    widgetDescription: 'Current weather card',
    template: (ctx) => {
      const { output, helpers } = ctx;
      return `
        <div style="padding:16px;font-family:system-ui;border-radius:12px;background:#f5f7fa">
          <h2 style="margin:0 0 8px">${helpers.escapeHtml(output.location)}</h2>
          <p style="font-size:48px;margin:0">${output.temperatureF}°F</p>
          <p style="margin:8px 0 0">${helpers.escapeHtml(output.conditions)}</p>
          <p style="margin:4px 0 0;color:#666">Humidity: ${output.humidityPct}%</p>
        </div>
      `;
    },
  },
})
class GetWeatherTool extends ToolContext {
  async execute(input: GetWeatherInput): Promise<GetWeatherOutput> {
    return {
      location: input.location,
      temperatureF: 72,
      conditions: 'Sunny',
      humidityPct: 55,
    };
  }
}

export { GetWeatherTool };
```

```typescript
// src/apps/main/index.ts
import { App } from '@frontmcp/sdk';

import { GetWeatherTool } from './tools/get-weather.tool';

@App({
  name: 'main',
  tools: [GetWeatherTool],
})
class MainApp {}

export { MainApp };
```

## What This Demonstrates

- Adding `ui:` to `@Tool({...})` with a function template `(ctx) => string`
- Reading `ctx.input`, `ctx.output`, and `ctx.helpers` from the typed `TemplateContext`
- Escaping user-controlled strings via `ctx.helpers.escapeHtml(...)`
- Letting `servingMode` default to `auto` so the SDK picks the right mode per host (OpenAI vs Claude vs no-UI)
- Surfacing `widgetDescription` for the host UI

## Related

- See `create-tool-ui` for the full options reference, serving modes, CSP, and bridge API
- See `create-tool` for the underlying `@Tool` decorator and `ToolContext` patterns
