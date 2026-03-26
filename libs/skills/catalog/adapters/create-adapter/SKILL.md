---
name: create-adapter
description: Create custom adapters that convert external definitions into MCP tools, resources, and prompts. Use when building integrations beyond OpenAPI, connecting to proprietary APIs, or generating tools from custom schemas.
tags: [adapter, custom, dynamic-adapter, integration, codegen]
priority: 6
visibility: both
license: Apache-2.0
metadata:
  docs: https://docs.agentfront.dev/frontmcp/adapters/overview
---

# Creating Custom Adapters

Build adapters that automatically generate MCP tools, resources, and prompts from external sources — databases, GraphQL schemas, proprietary APIs, or any definition format.

## When to Use

Create a custom adapter when:

- The built-in OpenAPI adapter doesn't cover your integration (GraphQL, gRPC, custom protocols)
- You want to auto-generate tools from a database schema or config file
- You need to dynamically create tools at runtime based on external state

## Step 1: Extend DynamicAdapter

```typescript
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
    // ...
  }

  private async callApi(operation: string, input: Record<string, unknown>) {
    // Call the external API
    // ...
  }
}
```

## Step 2: Register

```typescript
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

## FrontMcpAdapterResponse

The `fetch()` method returns tools, resources, and prompts to register:

```typescript
interface FrontMcpAdapterResponse {
  tools?: AdapterToolDefinition[];
  resources?: AdapterResourceDefinition[];
  prompts?: AdapterPromptDefinition[];
}
```

## Static init()

`DynamicAdapter` provides a static `init()` method inherited by all subclasses:

```typescript
// Usage — no manual instantiation needed
const adapter = MyApiAdapter.init({
  name: 'my-api',        // Required: adapter name (used for tool namespacing)
  endpoint: '...',
  apiKey: '...',
});

// Register in @App
@App({ adapters: [adapter] })
```

## Nx Generator

```bash
nx generate @frontmcp/nx:adapter my-adapter --project=my-app
```

Creates a `DynamicAdapter` subclass in `src/adapters/my-adapter.adapter.ts`.

## Reference

- Adapter docs: [docs.agentfront.dev/frontmcp/adapters/overview](https://docs.agentfront.dev/frontmcp/adapters/overview)
- `DynamicAdapter` base: import from `@frontmcp/sdk` — [source](https://github.com/agentfront/frontmcp/tree/main/libs/sdk/src/common/dynamic/dynamic.adapter.ts)
- `FrontMcpAdapterResponse`: import from `@frontmcp/sdk` — [source](https://github.com/agentfront/frontmcp/tree/main/libs/sdk/src/common/interfaces/adapter.interface.ts)
