# Navigator Model Context API

The `navigator.modelContext` API provides W3C-aligned browser-native access to MCP functionality. FrontMCP Browser includes a polyfill that enables this API in all modern browsers.

## Overview

The Navigator Model Context API is a proposed W3C standard for AI-accessible websites. It provides a standardized way for web applications to expose their capabilities to AI agents through the MCP protocol.

### Design Goals

1. **Browser-Native Experience** - No server changes required
2. **W3C Alignment** - Following emerging web standards
3. **Progressive Enhancement** - Works alongside existing MCP transports
4. **Security-First** - Tools inherit user sessions and permissions
5. **Framework Agnostic** - Works with React, Vue, Svelte, or vanilla JS

## Installation

```typescript
// Import the polyfill at your application entry point
import '@frontmcp/browser/polyfill';

// TypeScript users: import types
import type { ModelContext } from '@frontmcp/browser/types';
```

## Basic Usage

### Connecting to Model Context

```typescript
// Check for API availability
if ('modelContext' in navigator) {
  const mcp = await navigator.modelContext.connect({
    serverInfo: {
      name: 'MyApp',
      version: '1.0.0',
    },
  });

  console.log('Connected to Model Context:', mcp.clientInfo);
}
```

### Registering Tools

```typescript
import { z } from 'zod';

// Register a tool with Zod schema validation
mcp.registerTool('search', {
  description: 'Search for products in the catalog',
  inputSchema: z.object({
    query: z.string().min(1),
    limit: z.number().int().min(1).max(100).default(10),
    category: z.string().optional(),
  }),
  execute: async (args) => {
    const results = await searchProducts(args.query, {
      limit: args.limit,
      category: args.category,
    });
    return { results, total: results.length };
  },
});

// Register with JSON Schema (for non-TypeScript usage)
mcp.registerTool('getUser', {
  description: 'Get user profile by ID',
  inputSchema: {
    type: 'object',
    properties: {
      userId: { type: 'string', format: 'uuid' },
    },
    required: ['userId'],
  },
  execute: async (args) => {
    return await fetchUser(args.userId);
  },
});
```

### Registering Resources

```typescript
// Static resource
mcp.registerResource('config://settings', {
  name: 'Application Settings',
  description: 'Current application configuration',
  mimeType: 'application/json',
  read: async () => ({
    contents: [
      {
        uri: 'config://settings',
        mimeType: 'application/json',
        text: JSON.stringify(getSettings()),
      },
    ],
  }),
});

// Resource template with parameters
mcp.registerResource('user://{userId}/profile', {
  name: 'User Profile',
  description: 'Get profile for a specific user',
  mimeType: 'application/json',
  read: async (params) => {
    const profile = await fetchUserProfile(params.userId);
    return {
      contents: [
        {
          uri: `user://${params.userId}/profile`,
          mimeType: 'application/json',
          text: JSON.stringify(profile),
        },
      ],
    };
  },
});
```

### Registering Prompts

```typescript
mcp.registerPrompt('code-review', {
  name: 'Code Review',
  description: 'Generate a code review for the given code',
  arguments: [
    { name: 'code', description: 'The code to review', required: true },
    { name: 'language', description: 'Programming language', required: false },
    { name: 'focus', description: 'What to focus on', required: false },
  ],
  execute: async (args) => ({
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: `Please review this ${args.language || 'code'}:\n\n${args.code}\n\n${
            args.focus ? `Focus on: ${args.focus}` : ''
          }`,
        },
      },
    ],
  }),
});
```

## API Reference

### `navigator.modelContext`

The global entry point for the Model Context API.

```typescript
interface NavigatorModelContext {
  /**
   * Connect to a model context session
   */
  connect(options: ConnectOptions): Promise<ModelContextSession>;

  /**
   * Check if the API is supported
   */
  readonly supported: boolean;

  /**
   * Get the polyfill version (undefined if native)
   */
  readonly polyfillVersion?: string;
}
```

### `ConnectOptions`

```typescript
interface ConnectOptions {
  /**
   * Server information to advertise to clients
   */
  serverInfo: {
    name: string;
    version: string;
    description?: string;
  };

  /**
   * Optional transport configuration
   * @default EventTransport
   */
  transport?: TransportConfig;

  /**
   * Optional capabilities to advertise
   */
  capabilities?: {
    tools?: { listChanged?: boolean };
    resources?: { subscribe?: boolean; listChanged?: boolean };
    prompts?: { listChanged?: boolean };
    logging?: {};
  };

  /**
   * Connection timeout in milliseconds
   * @default 30000
   */
  timeout?: number;
}
```

### `ModelContextSession`

```typescript
interface ModelContextSession {
  /**
   * Information about the connected client
   */
  readonly clientInfo: ClientInfo;

  /**
   * Current connection state
   */
  readonly state: 'connected' | 'disconnected' | 'connecting';

  /**
   * Register a tool for AI agents to use
   */
  registerTool<In, Out>(name: string, definition: ToolDefinition<In, Out>): () => void;

  /**
   * Register a resource for AI agents to read
   */
  registerResource<Params extends Record<string, string>>(
    uri: string,
    definition: ResourceDefinition<Params>,
  ): () => void;

  /**
   * Register a prompt template
   */
  registerPrompt(name: string, definition: PromptDefinition): () => void;

  /**
   * Unregister a tool by name
   */
  unregisterTool(name: string): void;

  /**
   * Unregister a resource by URI
   */
  unregisterResource(uri: string): void;

  /**
   * Unregister a prompt by name
   */
  unregisterPrompt(name: string): void;

  /**
   * Send a notification to connected clients
   */
  notify(method: string, params?: unknown): void;

  /**
   * Close the session
   */
  close(): Promise<void>;

  /**
   * Event handlers
   */
  on(event: 'disconnect', handler: () => void): () => void;
  on(event: 'error', handler: (error: Error) => void): () => void;
  on(event: 'toolCall', handler: (name: string, args: unknown) => void): () => void;
}
```

### `ToolDefinition`

```typescript
interface ToolDefinition<In, Out> {
  /**
   * Human-readable description of the tool
   */
  description: string;

  /**
   * Input schema (Zod schema or JSON Schema)
   */
  inputSchema: ZodType<In> | JSONSchema;

  /**
   * Output schema (optional, for validation)
   */
  outputSchema?: ZodType<Out> | JSONSchema;

  /**
   * Tool execution function
   */
  execute: (args: In) => Promise<Out> | Out;

  /**
   * Optional metadata for tool-to-UI linking
   */
  _meta?: {
    resourceUri?: string;
    uiHint?: 'form' | 'modal' | 'inline' | 'panel';
    confirmRequired?: boolean;
  };
}
```

### `ResourceDefinition`

```typescript
interface ResourceDefinition<Params extends Record<string, string>> {
  /**
   * Human-readable name
   */
  name: string;

  /**
   * Human-readable description
   */
  description?: string;

  /**
   * MIME type of the resource content
   */
  mimeType?: string;

  /**
   * Read the resource content
   */
  read: (params: Params) => Promise<ReadResourceResult> | ReadResourceResult;

  /**
   * Optional subscription support
   */
  subscribe?: (params: Params, callback: () => void) => () => void;
}
```

### `PromptDefinition`

```typescript
interface PromptDefinition {
  /**
   * Human-readable name
   */
  name?: string;

  /**
   * Human-readable description
   */
  description?: string;

  /**
   * Prompt arguments
   */
  arguments?: PromptArgument[];

  /**
   * Generate the prompt messages
   */
  execute: (args: Record<string, string>) => Promise<GetPromptResult> | GetPromptResult;
}

interface PromptArgument {
  name: string;
  description?: string;
  required?: boolean;
}
```

## Dynamic Tool Management

Tools, resources, and prompts can be registered and unregistered after the connection is established:

```typescript
const mcp = await navigator.modelContext.connect({
  serverInfo: { name: 'DynamicApp', version: '1.0.0' },
});

// Register tools dynamically based on user permissions
if (user.hasPermission('admin')) {
  mcp.registerTool('deleteUser', {
    description: 'Delete a user account',
    inputSchema: z.object({ userId: z.string() }),
    execute: async (args) => {
      /* ... */
    },
  });
}

// Unregister when permissions change
user.on('permissionsChanged', () => {
  if (!user.hasPermission('admin')) {
    mcp.unregisterTool('deleteUser');
  }
});
```

## Session Inheritance

Tools registered via `navigator.modelContext` inherit the user's session and permissions:

```typescript
mcp.registerTool('purchaseItem', {
  description: 'Purchase an item from the store',
  inputSchema: z.object({
    itemId: z.string(),
    quantity: z.number().int().positive(),
  }),
  execute: async (args, context) => {
    // The execution context includes the user's session
    const session = context.session;

    // Validate user can make purchases
    if (!session.user.canPurchase) {
      throw new Error('User is not authorized to make purchases');
    }

    // Make purchase with user's payment method
    return await makePurchase(args.itemId, args.quantity, {
      userId: session.user.id,
      paymentMethod: session.user.defaultPaymentMethod,
    });
  },
});
```

## TypeScript Support

Full TypeScript type definitions are included:

```typescript
// types.d.ts extension
declare global {
  interface Navigator {
    readonly modelContext: NavigatorModelContext;
  }
}

// Using with strict types
import type {
  ModelContextSession,
  ToolDefinition,
  ResourceDefinition,
  PromptDefinition,
  ConnectOptions,
} from '@frontmcp/browser/types';

const toolDef: ToolDefinition<{ query: string }, { results: string[] }> = {
  description: 'Search',
  inputSchema: z.object({ query: z.string() }),
  execute: async (args) => ({ results: await search(args.query) }),
};
```

## Error Handling

```typescript
try {
  const mcp = await navigator.modelContext.connect({
    serverInfo: { name: 'MyApp', version: '1.0.0' },
    timeout: 10000,
  });
} catch (error) {
  if (error instanceof ModelContextConnectionError) {
    console.error('Failed to connect:', error.message);
  } else if (error instanceof ModelContextTimeoutError) {
    console.error('Connection timed out');
  }
}

// Handle errors during tool registration
try {
  mcp.registerTool('myTool', {
    description: 'My tool',
    inputSchema: z.object({}),
    execute: async () => {
      throw new Error('Tool execution failed');
    },
  });
} catch (error) {
  if (error instanceof ToolRegistrationError) {
    console.error('Failed to register tool:', error.message);
  }
}
```

## Browser Compatibility

The polyfill supports:

| Browser | Minimum Version |
| ------- | --------------- |
| Chrome  | 80+             |
| Firefox | 78+             |
| Safari  | 14+             |
| Edge    | 80+             |

### Feature Detection

```typescript
// Check for native support (future)
const isNative = 'modelContext' in navigator && !navigator.modelContext.polyfillVersion;

// Check for polyfill
const isPolyfill = 'modelContext' in navigator && navigator.modelContext.polyfillVersion;

// Check for any support
const isSupported = navigator.modelContext?.supported ?? false;
```

## Comparison with WebMCP

FrontMCP's `navigator.modelContext` implementation extends the WebMCP specification with:

| Feature                      | WebMCP | FrontMCP |
| ---------------------------- | ------ | -------- |
| `navigator.modelContext` API | Yes    | Yes      |
| Zod schema validation        | No     | Yes      |
| Valtio store integration     | No     | Yes      |
| Tool-to-UI linking           | Yes    | Yes      |
| Resource templates           | Yes    | Yes      |
| Dynamic registration         | Yes    | Yes      |
| Session inheritance          | Yes    | Yes      |

## Integration with Store

```typescript
import { createMcpStore } from '@frontmcp/browser';

const store = createMcpStore({ count: 0, user: null });
const mcp = await navigator.modelContext.connect({
  /* ... */
});

// Register store as resource
mcp.registerResource('store://{key}', {
  name: 'Store Value',
  description: 'Access reactive store values',
  read: async (params) => ({
    contents: [
      {
        uri: `store://${params.key}`,
        mimeType: 'application/json',
        text: JSON.stringify(store.state[params.key]),
      },
    ],
  }),
  subscribe: (params, callback) => {
    return store.subscribeKey(params.key, callback);
  },
});

// Register store mutation tool
mcp.registerTool('store:set', {
  description: 'Set a value in the store',
  inputSchema: z.object({
    key: z.string(),
    value: z.unknown(),
  }),
  execute: async (args) => {
    store.state[args.key] = args.value;
    return { success: true };
  },
});
```

## See Also

- [ARCHITECTURE.md](./ARCHITECTURE.md) - Overall architecture documentation
- [TRANSPORT.md](./TRANSPORT.md) - Transport layer documentation
- [REACT.md](./REACT.md) - React integration and hooks
- [APP-BRIDGE.md](./APP-BRIDGE.md) - Embedding MCP apps in iframes
