# Schema-Driven Store

Define stores using Zod schemas where actions automatically become MCP tools. This pattern separates business logic from UI and reduces boilerplate.

## Table of Contents

- [Overview](#overview)
- [Quick Start](#quick-start)
- [API Reference](#api-reference)
- [Defining Actions](#defining-actions)
- [Action Context](#action-context)
- [Auto-Registration](#auto-registration)
- [Generated Resources](#generated-resources)
- [Persistence](#persistence)
- [React Integration](#react-integration)
- [Examples](#examples)
- [Comparison with createMcpStore](#comparison-with-createmcpstore)

---

## Overview

The schema-driven store pattern allows you to:

1. **Define state shape with Zod** - Get type safety and automatic defaults
2. **Define actions with schemas** - Input/output validation built-in
3. **Auto-register as MCP tools** - Actions become AI-callable tools
4. **Direct state mutations** - No reducers, just mutate the Valtio proxy
5. **Compose actions** - Call other actions from within an action

### Why Schema-Driven?

| Traditional Approach         | Schema-Driven Approach         |
| ---------------------------- | ------------------------------ |
| Define state separately      | State shape from Zod schema    |
| Write tool registration code | Auto-generated from actions    |
| Manual input validation      | Zod validates automatically    |
| Separate tool and UI logic   | Actions work for both          |
| Manual resource setup        | Auto-generated store resources |

### Architecture

```
defineStore({schema, actions})
        │
        ▼
┌─────────────────────────────────────────────────────────┐
│                    SchemaStore<T>                        │
│  ┌──────────────┐  ┌─────────────┐  ┌─────────────────┐ │
│  │ Valtio Proxy │  │ Generated   │  │ Generated       │ │
│  │ State        │  │ Tools       │  │ Resources       │ │
│  └──────────────┘  └─────────────┘  └─────────────────┘ │
│                              │                           │
│                   store.registerWith(server)             │
│                              ▼                           │
│                   ┌──────────────────┐                  │
│                   │ BrowserMcpServer │                  │
│                   └──────────────────┘                  │
└─────────────────────────────────────────────────────────┘
```

---

## Quick Start

```typescript
import { defineStore } from '@frontmcp/browser';
import { z } from 'zod';

// 1. Define your store with schema and actions
const counterStore = defineStore({
  name: 'counter',

  schema: z.object({
    count: z.number().default(0),
    lastUpdated: z.string().nullable().default(null),
  }),

  actions: {
    increment: {
      description: 'Increment the counter by a given amount',
      input: z.object({ amount: z.number().default(1) }),
      output: z.object({ newCount: z.number() }),
      execute: async (input, ctx) => {
        ctx.state.count += input.amount;
        ctx.state.lastUpdated = new Date().toISOString();
        return { newCount: ctx.state.count };
      },
    },

    reset: {
      description: 'Reset the counter to zero',
      input: z.object({}),
      output: z.object({ success: z.boolean() }),
      execute: async (_input, ctx) => {
        ctx.state.count = 0;
        ctx.state.lastUpdated = null;
        return { success: true };
      },
    },
  },
});

// 2. Register with MCP server
const server = await createBrowserMcpServer({
  info: { name: 'MyApp', version: '1.0.0' },
});
counterStore.registerWith(server);

// 3. Use in your UI
console.log(counterStore.state.count); // 0
await counterStore.actions.increment({ amount: 5 });
console.log(counterStore.state.count); // 5

// AI can now call:
// - counter:increment
// - counter:reset
// And read resources:
// - store://counter
// - store://counter/count
```

---

## API Reference

### `defineStore(options)`

Creates a schema-driven store with auto-registered actions.

```typescript
function defineStore<TShape, TActions>(
  options: DefineStoreOptions<TShape, TActions>,
): SchemaStore<z.infer<z.ZodObject<TShape>>, TActions>;
```

### `DefineStoreOptions`

```typescript
interface DefineStoreOptions<TShape, TActions> {
  /**
   * Unique store name - used for tool and resource naming
   * Tools: {name}:{actionName}
   * Resources: store://{name}
   */
  name: string;

  /**
   * Zod object schema defining state shape
   * All fields should have .default() or be .optional()
   */
  schema: z.ZodObject<TShape>;

  /**
   * Map of action definitions
   */
  actions: TActions;

  /**
   * Optional persistence configuration
   */
  persistence?: {
    /** Storage backend */
    storage: 'indexeddb' | 'localstorage' | 'memory';
    /** Custom storage key (default: store name) */
    key?: string;
    /** Debounce writes in ms (default: 100) */
    debounce?: number;
  };

  /**
   * Optional resource configuration
   */
  resources?: {
    /** Expose root store as resource (default: true) */
    exposeRoot?: boolean;
    /** Additional paths to expose as individual resources */
    exposePaths?: string[];
    /** Enable subscription notifications (default: true) */
    subscribe?: boolean;
  };
}
```

### `SchemaStore<TState, TActions>`

The return type from `defineStore()`.

```typescript
interface SchemaStore<TState, TActions> {
  /** Store name */
  readonly name: string;

  /** Mutable Valtio proxy state - mutate directly */
  readonly state: TState;

  /** Get immutable snapshot of current state */
  getSnapshot(): Readonly<TState>;

  /** Subscribe to all state changes */
  subscribe(callback: () => void): () => void;

  /** Subscribe to specific key changes */
  subscribeKey<K extends keyof TState>(key: K, callback: (value: TState[K]) => void): () => void;

  /** Type-safe action executors */
  readonly actions: {
    [K in keyof TActions]: (input: z.infer<TActions[K]['input']>) => Promise<z.infer<TActions[K]['output']>>;
  };

  /** Generated MCP tools (for manual registration if needed) */
  readonly tools: StoreGeneratedTool[];

  /** Generated MCP resources (for manual registration if needed) */
  readonly resources: StoreGeneratedResource[];

  /** Reset state to schema defaults */
  reset(): void;

  /** Register all tools and resources with an MCP server */
  registerWith(server: BrowserMcpServer): void;
}
```

---

## Defining Actions

Actions are the core of schema-driven stores. Each action:

- Has typed input/output via Zod schemas
- Can mutate state directly
- Becomes an MCP tool automatically

### `StoreActionDefinition`

```typescript
interface StoreActionDefinition<TState, TInput, TOutput> {
  /**
   * Human-readable description for MCP tool discovery
   */
  description?: string;

  /**
   * Zod schema for action input
   */
  input: z.ZodObject<TInput>;

  /**
   * Zod schema for action output
   */
  output: z.ZodObject<TOutput> | z.ZodType;

  /**
   * Action implementation
   */
  execute: (input: z.infer<z.ZodObject<TInput>>, ctx: StoreActionContext<TState>) => Promise<z.infer<TOutput>>;

  /**
   * Optional MCP tool annotations
   */
  annotations?: {
    /** Tool only reads data, doesn't modify state */
    readOnlyHint?: boolean;
    /** Tool performs destructive/irreversible operations */
    destructiveHint?: boolean;
    /** Tool can be safely retried */
    idempotentHint?: boolean;
  };
}
```

### Action Examples

```typescript
const userStore = defineStore({
  name: 'user',
  schema: z.object({
    name: z.string().default(''),
    email: z.string().email().default(''),
    preferences: z.object({
      theme: z.enum(['light', 'dark']).default('light'),
      notifications: z.boolean().default(true),
    }),
  }),

  actions: {
    // Simple action with direct state mutation
    setName: {
      description: 'Update the user name',
      input: z.object({ name: z.string().min(1) }),
      output: z.object({ name: z.string() }),
      execute: async (input, ctx) => {
        ctx.state.name = input.name;
        return { name: input.name };
      },
    },

    // Action with multiple fields
    updateProfile: {
      description: 'Update multiple profile fields at once',
      input: z.object({
        name: z.string().optional(),
        email: z.string().email().optional(),
      }),
      output: z.object({
        updated: z.array(z.string()),
        success: z.boolean(),
      }),
      execute: async (input, ctx) => {
        const updated: string[] = [];

        if (input.name !== undefined) {
          ctx.state.name = input.name;
          updated.push('name');
        }
        if (input.email !== undefined) {
          ctx.state.email = input.email;
          updated.push('email');
        }

        return { updated, success: true };
      },
    },

    // Action mutating nested state
    setTheme: {
      description: 'Change the UI theme',
      input: z.object({ theme: z.enum(['light', 'dark']) }),
      output: z.object({ theme: z.enum(['light', 'dark']) }),
      execute: async (input, ctx) => {
        ctx.state.preferences.theme = input.theme;
        return { theme: input.theme };
      },
      annotations: { idempotentHint: true },
    },

    // Read-only action (queries state)
    getPreferences: {
      description: 'Get current user preferences',
      input: z.object({}),
      output: z.object({
        theme: z.enum(['light', 'dark']),
        notifications: z.boolean(),
      }),
      execute: async (_input, ctx) => {
        const snap = ctx.getSnapshot();
        return {
          theme: snap.preferences.theme,
          notifications: snap.preferences.notifications,
        };
      },
      annotations: { readOnlyHint: true },
    },
  },
});
```

---

## Action Context

Every action receives a context object providing access to state and utilities.

### `StoreActionContext<TState>`

```typescript
interface StoreActionContext<TState> {
  /**
   * Mutable Valtio proxy state
   * Mutate directly: ctx.state.count++
   */
  state: TState;

  /**
   * Get immutable snapshot of current state
   * Use for reading when you don't want to trigger reactivity
   */
  getSnapshot(): Readonly<TState>;

  /**
   * Call another action in the same store
   * Input is validated against the target action's schema
   */
  call<TActionName extends string, TInput, TOutput>(actionName: TActionName, input: TInput): Promise<TOutput>;

  /**
   * Call an external MCP tool (outside this store)
   * Requires server registration
   */
  callTool<TInput, TOutput>(toolName: string, args: TInput): Promise<TOutput>;

  /**
   * Logger scoped to this action
   */
  logger: {
    debug(message: string, data?: unknown): void;
    info(message: string, data?: unknown): void;
    warn(message: string, data?: unknown): void;
    error(message: string, data?: unknown): void;
  };

  /** Store name */
  storeName: string;

  /** Current action name */
  actionName: string;
}
```

### Using `ctx.call()` for Action Composition

Actions can call other actions in the same store:

```typescript
const authStore = defineStore({
  name: 'auth',
  schema: z.object({
    isLoggedIn: z.boolean().default(false),
    user: z
      .object({
        id: z.string(),
        name: z.string(),
        email: z.string(),
      })
      .nullable()
      .default(null),
    token: z.string().nullable().default(null),
  }),

  actions: {
    setUser: {
      input: z.object({
        id: z.string(),
        name: z.string(),
        email: z.string(),
      }),
      output: z.object({ success: z.boolean() }),
      execute: async (input, ctx) => {
        ctx.state.user = input;
        return { success: true };
      },
    },

    setToken: {
      input: z.object({ token: z.string() }),
      output: z.object({ success: z.boolean() }),
      execute: async (input, ctx) => {
        ctx.state.token = input.token;
        return { success: true };
      },
    },

    // Composite action calling other actions
    login: {
      description: 'Log in with credentials',
      input: z.object({
        email: z.string().email(),
        password: z.string(),
      }),
      output: z.object({ success: z.boolean(), error: z.string().optional() }),
      execute: async (input, ctx) => {
        try {
          // Simulate API call
          const response = await fetch('/api/login', {
            method: 'POST',
            body: JSON.stringify(input),
          });
          const data = await response.json();

          // Call other actions to update state
          await ctx.call('setUser', {
            id: data.user.id,
            name: data.user.name,
            email: data.user.email,
          });
          await ctx.call('setToken', { token: data.token });

          ctx.state.isLoggedIn = true;
          ctx.logger.info('User logged in', { userId: data.user.id });

          return { success: true };
        } catch (error) {
          ctx.logger.error('Login failed', { error });
          return { success: false, error: 'Login failed' };
        }
      },
    },

    logout: {
      description: 'Log out the current user',
      input: z.object({}),
      output: z.object({ success: z.boolean() }),
      execute: async (_input, ctx) => {
        ctx.state.isLoggedIn = false;
        ctx.state.user = null;
        ctx.state.token = null;
        return { success: true };
      },
      annotations: { destructiveHint: true },
    },
  },
});
```

### Using `ctx.callTool()` for External Tools

Call tools from other stores or external MCP servers:

```typescript
const orderStore = defineStore({
  name: 'order',
  schema: z.object({
    items: z
      .array(
        z.object({
          productId: z.string(),
          quantity: z.number(),
        }),
      )
      .default([]),
    total: z.number().default(0),
  }),

  actions: {
    checkout: {
      description: 'Process checkout and notify user',
      input: z.object({}),
      output: z.object({ orderId: z.string() }),
      execute: async (_input, ctx) => {
        // Process order...
        const orderId = crypto.randomUUID();

        // Call external notification tool
        await ctx.callTool('notifications:sendEmail', {
          to: 'user@example.com',
          subject: 'Order Confirmed',
          body: `Your order ${orderId} has been placed.`,
        });

        // Clear cart
        ctx.state.items = [];
        ctx.state.total = 0;

        return { orderId };
      },
    },
  },
});
```

---

## Auto-Registration

When you call `store.registerWith(server)`, actions become MCP tools automatically.

### Tool Naming Convention

Tools are named: `{storeName}:{actionName}`

```typescript
const todoStore = defineStore({
  name: 'todos',
  actions: {
    addTodo: {
      /* ... */
    },
    toggleTodo: {
      /* ... */
    },
    deleteTodo: {
      /* ... */
    },
  },
});

// Registers these tools:
// - todos:addTodo
// - todos:toggleTodo
// - todos:deleteTodo
```

### What Gets Registered

```typescript
todoStore.registerWith(server);

// Equivalent to:
server.registerTool({
  name: 'todos:addTodo',
  description: 'Add a new todo item',
  inputSchema: {
    /* from action.input */
  },
  execute: async (args) => {
    /* action.execute */
  },
});

server.registerResource({
  uri: 'store://todos',
  name: 'todos Store',
  read: async () => ({
    contents: [
      {
        /* state snapshot */
      },
    ],
  }),
});

// Plus change notifications
store.subscribe(() => {
  server.notify('notifications/resources/updated', {
    uri: 'store://todos',
  });
});
```

### Manual Registration

If you need more control, access tools/resources directly:

```typescript
// Register only specific tools
for (const tool of todoStore.tools) {
  if (tool.name !== 'todos:deleteTodo') {
    server.registerTool(tool);
  }
}

// Register with custom transformation
for (const resource of todoStore.resources) {
  server.registerResource({
    ...resource,
    name: `My App - ${resource.name}`,
  });
}
```

---

## Generated Resources

Schema stores automatically generate MCP resources for state access.

### Default Resources

```typescript
const settingsStore = defineStore({
  name: 'settings',
  schema: z.object({
    theme: z.enum(['light', 'dark']).default('light'),
    language: z.string().default('en'),
    notifications: z.object({
      email: z.boolean().default(true),
      push: z.boolean().default(false),
    }),
  }),
  // ...
});

// Auto-generates:
// store://settings           - Full state object
// store://settings/{path}    - Template for any path
```

### Custom Resource Paths

```typescript
const settingsStore = defineStore({
  name: 'settings',
  schema: {
    /* ... */
  },
  actions: {
    /* ... */
  },

  resources: {
    exposeRoot: true,
    exposePaths: ['theme', 'language', 'notifications/email', 'notifications/push'],
  },
});

// Generates:
// store://settings
// store://settings/theme
// store://settings/language
// store://settings/notifications/email
// store://settings/notifications/push
// store://settings/{path}  (template for any other path)
```

### Reading Resources

AI agents can read store state:

```
AI: "Read resource store://settings/theme"
→ { "contents": [{ "uri": "store://settings/theme", "text": "\"dark\"" }] }

AI: "Read resource store://settings"
→ { "contents": [{ "uri": "store://settings", "text": "{\"theme\":\"dark\",\"language\":\"en\",...}" }] }
```

---

## Persistence

Configure automatic state persistence to survive page reloads.

### IndexedDB (Recommended)

```typescript
const userStore = defineStore({
  name: 'user',
  schema: {
    /* ... */
  },
  actions: {
    /* ... */
  },

  persistence: {
    storage: 'indexeddb',
    key: 'my-app-user-store', // Custom key (default: store name)
    debounce: 200, // Debounce writes (default: 100ms)
  },
});
```

### localStorage

```typescript
const settingsStore = defineStore({
  name: 'settings',
  schema: {
    /* ... */
  },
  actions: {
    /* ... */
  },

  persistence: {
    storage: 'localstorage',
  },
});
```

### Memory Only (No Persistence)

```typescript
const tempStore = defineStore({
  name: 'temp',
  schema: {
    /* ... */
  },
  actions: {
    /* ... */
  },

  persistence: {
    storage: 'memory', // State lost on page reload
  },
});
```

### Selective Persistence

Fields prefixed with `_` are not persisted:

```typescript
const appStore = defineStore({
  name: 'app',
  schema: z.object({
    user: z.object({
      /* ... */
    }), // Persisted
    settings: z.object({
      /* ... */
    }), // Persisted
    _cache: z.record(z.unknown()).default({}), // NOT persisted
    _tempData: z.unknown().default(null), // NOT persisted
  }),
  persistence: { storage: 'indexeddb' },
});
```

---

## React Integration

Schema stores work seamlessly with React via Valtio's `useSnapshot`.

### Basic Usage

```tsx
import { useSnapshot } from 'valtio/react';

function Counter() {
  const snap = useSnapshot(counterStore.state);

  return (
    <div>
      <p>Count: {snap.count}</p>
      <button onClick={() => counterStore.actions.increment({ amount: 1 })}>+1</button>
      <button onClick={() => counterStore.actions.reset({})}>Reset</button>
    </div>
  );
}
```

### With Store Context

```tsx
import { createContext, useContext } from 'react';
import { useSnapshot } from 'valtio/react';

// Create typed context
const TodoStoreContext = createContext(todoStore);

function useTodoStore() {
  const store = useContext(TodoStoreContext);
  const snap = useSnapshot(store.state);
  return { state: snap, actions: store.actions };
}

// Use in components
function TodoList() {
  const { state, actions } = useTodoStore();

  return (
    <ul>
      {state.items.map((item) => (
        <li key={item.id}>
          <input type="checkbox" checked={item.done} onChange={() => actions.toggleTodo({ id: item.id })} />
          {item.text}
        </li>
      ))}
    </ul>
  );
}
```

### Subscription Hooks

```tsx
import { useEffect, useState } from 'react';

function useStoreValue<T, K extends keyof T>(store: SchemaStore<T, any>, key: K): T[K] {
  const [value, setValue] = useState(store.state[key]);

  useEffect(() => {
    return store.subscribeKey(key, setValue);
  }, [store, key]);

  return value;
}

// Usage
function ThemeIndicator() {
  const theme = useStoreValue(settingsStore, 'theme');
  return <span>Current theme: {theme}</span>;
}
```

---

## Examples

### Todo App

```typescript
const todoStore = defineStore({
  name: 'todos',

  schema: z.object({
    items: z
      .array(
        z.object({
          id: z.string(),
          text: z.string(),
          done: z.boolean(),
          createdAt: z.number(),
        }),
      )
      .default([]),
    filter: z.enum(['all', 'active', 'completed']).default('all'),
  }),

  actions: {
    addTodo: {
      description: 'Add a new todo item',
      input: z.object({ text: z.string().min(1) }),
      output: z.object({ id: z.string() }),
      execute: async (input, ctx) => {
        const id = crypto.randomUUID();
        ctx.state.items.push({
          id,
          text: input.text,
          done: false,
          createdAt: Date.now(),
        });
        return { id };
      },
    },

    toggleTodo: {
      description: 'Toggle a todo item completion status',
      input: z.object({ id: z.string() }),
      output: z.object({ done: z.boolean() }),
      execute: async (input, ctx) => {
        const item = ctx.state.items.find((i) => i.id === input.id);
        if (!item) throw new Error('Todo not found');
        item.done = !item.done;
        return { done: item.done };
      },
    },

    deleteTodo: {
      description: 'Delete a todo item',
      input: z.object({ id: z.string() }),
      output: z.object({ success: z.boolean() }),
      execute: async (input, ctx) => {
        const index = ctx.state.items.findIndex((i) => i.id === input.id);
        if (index === -1) return { success: false };
        ctx.state.items.splice(index, 1);
        return { success: true };
      },
      annotations: { destructiveHint: true },
    },

    clearCompleted: {
      description: 'Remove all completed todos',
      input: z.object({}),
      output: z.object({ removed: z.number() }),
      execute: async (_input, ctx) => {
        const before = ctx.state.items.length;
        ctx.state.items = ctx.state.items.filter((i) => !i.done);
        return { removed: before - ctx.state.items.length };
      },
      annotations: { destructiveHint: true },
    },

    setFilter: {
      description: 'Set the todo filter',
      input: z.object({ filter: z.enum(['all', 'active', 'completed']) }),
      output: z.object({ filter: z.enum(['all', 'active', 'completed']) }),
      execute: async (input, ctx) => {
        ctx.state.filter = input.filter;
        return { filter: input.filter };
      },
    },
  },

  persistence: { storage: 'indexeddb' },
});

// AI can:
// - Call todos:addTodo to create items
// - Call todos:toggleTodo to mark complete
// - Call todos:clearCompleted to clean up
// - Read store://todos to see all items
// - Read store://todos/filter to see current filter
```

### Settings Store

```typescript
const settingsStore = defineStore({
  name: 'settings',

  schema: z.object({
    appearance: z.object({
      theme: z.enum(['light', 'dark', 'system']).default('system'),
      fontSize: z.enum(['small', 'medium', 'large']).default('medium'),
      reducedMotion: z.boolean().default(false),
    }),
    notifications: z.object({
      email: z.boolean().default(true),
      push: z.boolean().default(false),
      digest: z.enum(['daily', 'weekly', 'never']).default('weekly'),
    }),
    privacy: z.object({
      analytics: z.boolean().default(true),
      personalization: z.boolean().default(true),
    }),
  }),

  actions: {
    setTheme: {
      description: 'Change the color theme',
      input: z.object({ theme: z.enum(['light', 'dark', 'system']) }),
      output: z.object({ theme: z.enum(['light', 'dark', 'system']) }),
      execute: async (input, ctx) => {
        ctx.state.appearance.theme = input.theme;
        return { theme: input.theme };
      },
    },

    updateNotifications: {
      description: 'Update notification preferences',
      input: z.object({
        email: z.boolean().optional(),
        push: z.boolean().optional(),
        digest: z.enum(['daily', 'weekly', 'never']).optional(),
      }),
      output: z.object({ updated: z.array(z.string()) }),
      execute: async (input, ctx) => {
        const updated: string[] = [];
        if (input.email !== undefined) {
          ctx.state.notifications.email = input.email;
          updated.push('email');
        }
        if (input.push !== undefined) {
          ctx.state.notifications.push = input.push;
          updated.push('push');
        }
        if (input.digest !== undefined) {
          ctx.state.notifications.digest = input.digest;
          updated.push('digest');
        }
        return { updated };
      },
    },

    resetToDefaults: {
      description: 'Reset all settings to defaults',
      input: z.object({}),
      output: z.object({ success: z.boolean() }),
      execute: async (_input, ctx) => {
        // Use store reset
        ctx.state.appearance.theme = 'system';
        ctx.state.appearance.fontSize = 'medium';
        ctx.state.appearance.reducedMotion = false;
        ctx.state.notifications.email = true;
        ctx.state.notifications.push = false;
        ctx.state.notifications.digest = 'weekly';
        ctx.state.privacy.analytics = true;
        ctx.state.privacy.personalization = true;
        return { success: true };
      },
      annotations: { destructiveHint: true },
    },
  },

  persistence: { storage: 'localstorage' },

  resources: {
    exposePaths: ['appearance/theme', 'notifications', 'privacy'],
  },
});
```

---

## Comparison with createMcpStore

| Feature             | `createMcpStore`         | `defineStore`                |
| ------------------- | ------------------------ | ---------------------------- |
| State definition    | Plain object             | Zod schema with defaults     |
| Actions             | Manual tool registration | Auto-registered from schema  |
| Input validation    | Manual                   | Automatic via Zod            |
| Output validation   | None                     | Automatic via Zod            |
| Type inference      | From initial state       | From Zod schema              |
| Tool naming         | Manual                   | Automatic `{store}:{action}` |
| Action composition  | N/A                      | `ctx.call()`                 |
| External tool calls | N/A                      | `ctx.callTool()`             |
| Persistence         | Manual setup             | Declarative config           |

### When to Use Each

**Use `createMcpStore` when:**

- You need a simple reactive store without actions
- You want full control over tool registration
- You're integrating with existing code

**Use `defineStore` when:**

- You want automatic tool registration
- You need action composition
- You want schema-driven validation
- You prefer declarative configuration

---

## See Also

- [STORE.md](./STORE.md) - Basic reactive store with `createMcpStore`
- [API.md](./API.md) - Full API reference
- [REACT.md](./REACT.md) - React integration patterns
- [SECURITY.md](./SECURITY.md) - Authorization for store actions
