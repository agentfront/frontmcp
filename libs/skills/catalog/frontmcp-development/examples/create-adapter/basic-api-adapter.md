---
name: basic-api-adapter
reference: create-adapter
level: basic
description: 'A minimal adapter that fetches operation definitions from an external API and generates MCP tools.'
tags: [development, adapter, api]
features:
  - 'Extending `DynamicAdapter<TOptions>` with a typed options interface'
  - 'Declaring `__options_brand` for proper TypeScript inference on `init()`'
  - 'Implementing `fetch()` to return `FrontMcpAdapterResponse` with tools, resources, and prompts'
  - 'Registering the adapter via the static `init()` method in the `adapters` array'
---

# Basic Dynamic Adapter

A minimal adapter that fetches operation definitions from an external API and generates MCP tools.

## Code

```typescript
// src/adapters/my-api.adapter.ts
import { DynamicAdapter, type FrontMcpAdapterResponse } from '@frontmcp/sdk';

interface MyAdapterOptions {
  endpoint: string;
  apiKey: string;
}

class MyApiAdapter extends DynamicAdapter<MyAdapterOptions> {
  declare __options_brand: MyAdapterOptions;

  async fetch(): Promise<FrontMcpAdapterResponse> {
    // Fetch definitions from external source
    const res = await globalThis.fetch(this.options.endpoint, {
      headers: { Authorization: `Bearer ${this.options.apiKey}` },
    });
    const schema = await res.json();

    // Convert to MCP tool definitions
    return {
      tools: schema.operations.map((op: { name: string; description: string; params: Record<string, unknown> }) => ({
        name: op.name,
        description: op.description,
        inputSchema: this.convertParams(op.params),
        execute: async (input: Record<string, unknown>) => {
          return this.callApi(op.name, input);
        },
      })),
      resources: [],
      prompts: [],
    };
  }

  private convertParams(params: Record<string, unknown>) {
    // Convert external param definitions to Zod schemas
    return {};
  }

  private async callApi(operation: string, input: Record<string, unknown>) {
    // Call the external API
    return {};
  }
}
```

```typescript
// src/server.ts
import { App } from '@frontmcp/sdk';

@App({
  name: 'MyApp',
  adapters: [
    MyApiAdapter.init({
      name: 'my-api',
      endpoint: 'https://api.example.com/schema',
      apiKey: process.env.API_KEY!,
    }),
  ],
})
class MyApp {}
```

## What This Demonstrates

- Extending `DynamicAdapter<TOptions>` with a typed options interface
- Declaring `__options_brand` for proper TypeScript inference on `init()`
- Implementing `fetch()` to return `FrontMcpAdapterResponse` with tools, resources, and prompts
- Registering the adapter via the static `init()` method in the `adapters` array

## Related

- See `create-adapter` for namespacing, error handling, and the full adapter response interface
