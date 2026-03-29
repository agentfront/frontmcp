---
name: create-adapter
description: Build adapters that generate MCP tools and resources from external sources automatically
---

# Creating Custom Adapters

Build adapters that automatically generate MCP tools, resources, and prompts from external sources — databases, GraphQL schemas, proprietary APIs, or any definition format.

## When to Use This Skill

### Must Use

- Integrating a non-OpenAPI source (GraphQL, gRPC, database schema) that should generate MCP tools automatically
- Building a reusable adapter that converts external definitions into tools, resources, or prompts at startup
- Creating tools dynamically at runtime based on external state or configuration

### Recommended

- Wrapping a proprietary internal API that has its own schema format
- Auto-generating tools from a database schema or config file on server start
- Building an adapter that polls an external source and refreshes tool definitions periodically

### Skip When

- The external API has an OpenAPI/Swagger spec (see `official-adapters`)
- You need cross-cutting middleware behavior like logging or caching (see `create-plugin`)
- You are building a single static tool manually (see `create-tool`)

> **Decision:** Use this skill when you need to auto-generate MCP tools, resources, or prompts from a non-OpenAPI external source by extending `DynamicAdapter`.

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

## Common Patterns

| Pattern                 | Correct                                                       | Incorrect                                              | Why                                                                             |
| ----------------------- | ------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------- |
| Adapter registration    | `MyAdapter.init({ name: 'my-api', ... })` in `adapters` array | `new MyAdapter({ ... })` directly                      | `init()` returns the proper provider entry for DI wiring                        |
| Options branding        | `declare __options_brand: MyAdapterOptions;` in adapter class | Omitting the brand declaration                         | Brand ensures TypeScript infers the correct options type for `init()`           |
| Fetch return type       | Return `{ tools: [...], resources: [...], prompts: [...] }`   | Returning raw API response without conversion          | `fetch()` must return `FrontMcpAdapterResponse` with MCP-compatible definitions |
| Tool naming             | Namespace tools: `name: 'my-api:operation-name'`              | Flat names without namespace: `name: 'operation-name'` | Namespacing prevents collisions when multiple adapters are registered           |
| Error handling in fetch | Throw descriptive errors with endpoint info                   | Silently returning empty arrays on failure             | Adapter errors should surface at startup so misconfigurations are caught early  |

## Verification Checklist

### Configuration

- [ ] Adapter class extends `DynamicAdapter<TOptions>`
- [ ] `__options_brand` is declared with the correct options type
- [ ] `fetch()` method is implemented and returns `FrontMcpAdapterResponse`
- [ ] Adapter is registered via `.init()` in the `adapters` array of `@App`

### Runtime

- [ ] Generated tools appear in `tools/list` MCP response
- [ ] Tool names are namespaced with the adapter name (e.g., `my-api:operationId`)
- [ ] Generated tools accept valid input and return expected output
- [ ] Adapter fetch errors produce clear startup error messages

## Troubleshooting

| Problem                                    | Cause                                                       | Solution                                                                         |
| ------------------------------------------ | ----------------------------------------------------------- | -------------------------------------------------------------------------------- |
| No tools appear after adapter registration | `fetch()` returns empty `tools` array                       | Verify external source is reachable and response is parsed correctly             |
| TypeScript error on `.init()` options      | Missing `__options_brand` declaration                       | Add `declare __options_brand: MyAdapterOptions;` to the adapter class            |
| Tool input validation fails                | `inputSchema` conversion does not produce valid Zod schemas | Verify `convertParams` produces `z.object()` shapes matching the external schema |
| Duplicate tool name error                  | Multiple adapters produce tools with the same name          | Use unique `name` parameter in `init()` to namespace tools                       |
| Adapter not found at runtime               | Registered in wrong `@App` or not in `adapters` array       | Ensure `.init()` result is in the `adapters` array of the correct `@App`         |

## Reference

- [Adapter Documentation](https://docs.agentfront.dev/frontmcp/adapters/overview)
- Related skills: `official-adapters`, `create-plugin`, `create-tool`
