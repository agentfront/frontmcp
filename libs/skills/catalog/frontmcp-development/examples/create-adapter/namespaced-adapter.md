---
name: namespaced-adapter
reference: create-adapter
level: intermediate
description: 'An adapter that namespaces generated tools to avoid collisions and includes proper error handling for startup failures.'
tags: [development, adapter, namespaced]
features:
  - "Namespacing tools with `name: 'adapter-name:operation-name'` to prevent collisions"
  - 'Throwing descriptive errors in `fetch()` so misconfigurations surface at startup'
  - 'Registering multiple instances of the same adapter class with different configurations'
  - 'Validating the external response shape before generating tool definitions'
---

# Namespaced Adapter with Error Handling

An adapter that namespaces generated tools to avoid collisions and includes proper error handling for startup failures.

## Code

```typescript
// src/adapters/graphql-api.adapter.ts
import { DynamicAdapter, type FrontMcpAdapterResponse } from '@frontmcp/sdk';

interface GraphqlAdapterOptions {
  endpoint: string;
  apiKey: string;
  namespace?: string;
}

class GraphqlApiAdapter extends DynamicAdapter<GraphqlAdapterOptions> {
  declare __options_brand: GraphqlAdapterOptions;

  async fetch(): Promise<FrontMcpAdapterResponse> {
    const namespace = this.options.namespace ?? this.options.name;

    // Fetch schema from GraphQL introspection
    const res = await globalThis.fetch(this.options.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.options.apiKey}`,
      },
      body: JSON.stringify({
        query: '{ __schema { queryType { fields { name description } } } }',
      }),
    });

    if (!res.ok) {
      throw new Error(`GraphQL adapter failed to fetch schema from ${this.options.endpoint}: HTTP ${res.status}`);
    }

    const schema = await res.json();
    const fields = schema.data?.__schema?.queryType?.fields;

    if (!fields || !Array.isArray(fields)) {
      throw new Error(`GraphQL adapter received unexpected schema format from ${this.options.endpoint}`);
    }

    // Namespace tools to prevent collisions across adapters
    return {
      tools: fields.map((field: { name: string; description: string }) => ({
        name: `${namespace}:${field.name}`,
        description: field.description || `Query ${field.name} from GraphQL API`,
        inputSchema: {},
        execute: async (input: Record<string, unknown>) => {
          return this.executeQuery(field.name, input);
        },
      })),
    };
  }

  private async executeQuery(queryName: string, variables: Record<string, unknown>) {
    const res = await globalThis.fetch(this.options.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.options.apiKey}`,
      },
      body: JSON.stringify({ query: `{ ${queryName} }`, variables }),
    });
    return res.json();
  }
}
```

```typescript
// src/server.ts
import { FrontMcp, App } from '@frontmcp/sdk';

@App({
  name: 'DataApp',
  adapters: [
    // Each adapter uses its name for tool namespacing
    GraphqlApiAdapter.init({
      name: 'users-api',
      endpoint: 'https://users.example.com/graphql',
      apiKey: process.env.USERS_API_KEY!,
    }),
    GraphqlApiAdapter.init({
      name: 'orders-api',
      endpoint: 'https://orders.example.com/graphql',
      apiKey: process.env.ORDERS_API_KEY!,
    }),
  ],
})
class DataApp {}

@FrontMcp({
  info: { name: 'data-server', version: '1.0.0' },
  apps: [DataApp],
})
class DataServer {}
```

## What This Demonstrates

- Namespacing tools with `name: 'adapter-name:operation-name'` to prevent collisions
- Throwing descriptive errors in `fetch()` so misconfigurations surface at startup
- Registering multiple instances of the same adapter class with different configurations
- Validating the external response shape before generating tool definitions

## Related

- See `create-adapter` for the full `FrontMcpAdapterResponse` interface, Nx generator, and verification checklist
