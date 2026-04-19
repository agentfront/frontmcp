---
name: minimal-standalone-layout
reference: project-structure-standalone
level: basic
description: 'Set up the canonical file structure for a standalone FrontMCP project with one app, one tool, and the required entry point.'
tags: [setup, structure, standalone, minimal, layout]
features:
  - '`<name>.<type>.ts` file naming convention (`fetch-weather.tool.ts`, `my-app.app.ts`)'
  - '`main.ts` with a default-exported `@FrontMcp` server class'
  - 'One class per file pattern'
  - '`@App` grouping tools and registered in the server `apps` array'
---

# Minimal Standalone Project Layout

Set up the canonical file structure for a standalone FrontMCP project with one app, one tool, and the required entry point.

## Code

```typescript
// src/tools/fetch-weather.tool.ts
import { Tool, ToolContext, z } from '@frontmcp/sdk';

@Tool({
  name: 'fetch_weather',
  description: 'Fetch current weather for a city',
  inputSchema: { city: z.string() },
})
export default class FetchWeatherTool extends ToolContext {
  async execute(input: { city: string }) {
    return { content: [{ type: 'text', text: `Weather in ${input.city}: 22C, sunny` }] };
  }
}
```

```typescript
// src/my-app.app.ts
import { App } from '@frontmcp/sdk';

import FetchWeatherTool from './tools/fetch-weather.tool';

@App({
  name: 'my-app',
  tools: [FetchWeatherTool],
})
export class MyApp {}
```

```typescript
// src/main.ts
import 'reflect-metadata';

import { FrontMcp } from '@frontmcp/sdk';

import { MyApp } from './my-app.app';

@FrontMcp({
  info: { name: 'my-project', version: '1.0.0' },
  apps: [MyApp],
})
class MyServer {}

export default MyServer;
```

## What This Demonstrates

- `<name>.<type>.ts` file naming convention (`fetch-weather.tool.ts`, `my-app.app.ts`)
- `main.ts` with a default-exported `@FrontMcp` server class
- One class per file pattern
- `@App` grouping tools and registered in the server `apps` array

## Related

- See `project-structure-standalone` for the full file layout, naming conventions, and development workflow
