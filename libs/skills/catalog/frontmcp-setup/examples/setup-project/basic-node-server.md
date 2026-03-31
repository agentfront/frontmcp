---
name: basic-node-server
reference: setup-project
level: basic
description: 'Scaffold a minimal FrontMCP server with one app and one tool, running on Node.js with HTTP transport.'
tags: [setup, transport, node]
features:
  - 'Minimal `@FrontMcp` server with `info` and `apps` fields'
  - '`@App` decorator grouping a single tool'
  - '`@Tool` decorator with Zod input/output schemas extending `ToolContext`'
  - 'Required tsconfig flags: `experimentalDecorators` and `emitDecoratorMetadata`'
  - '`reflect-metadata` imported as the first line of the entry point'
---

# Basic Node.js Server Setup

Scaffold a minimal FrontMCP server with one app and one tool, running on Node.js with HTTP transport.

## Code

```typescript
// src/tools/add.tool.ts
import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

@Tool({
  name: 'add',
  description: 'Add two numbers',
  inputSchema: { a: z.number(), b: z.number() },
  outputSchema: { result: z.number() },
})
export default class AddTool extends ToolContext {
  async execute(input: { a: number; b: number }) {
    return {
      result: input.a + input.b,
    };
  }
}
```

```typescript
// src/apps/calc.app.ts
import { App } from '@frontmcp/sdk';
import AddTool from '../tools/add.tool';

@App({
  name: 'Calculator',
  tools: [AddTool],
})
export class CalcApp {}
```

```typescript
// src/main.ts
import 'reflect-metadata';
import { FrontMcp } from '@frontmcp/sdk';
import { CalcApp } from './apps/calc.app';

@FrontMcp({
  info: { name: 'my-server', version: '0.1.0' },
  apps: [CalcApp],
  http: { port: 3000 },
})
export default class Server {}
```

```json
// tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "declaration": true,
    "resolveJsonModule": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

## What This Demonstrates

- Minimal `@FrontMcp` server with `info` and `apps` fields
- `@App` decorator grouping a single tool
- `@Tool` decorator with Zod input/output schemas extending `ToolContext`
- Required tsconfig flags: `experimentalDecorators` and `emitDecoratorMetadata`
- `reflect-metadata` imported as the first line of the entry point

## Related

- See `setup-project` for the full scaffolding guide with CLI flags and deployment targets
