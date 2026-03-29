---
name: create-plugin
description: Build plugins with providers, context extensions, lifecycle hooks, and contributed tools
---

# Create a FrontMCP Plugin

This skill covers building custom plugins for FrontMCP and using all 6 official plugins. Plugins are modular units that extend server behavior through providers, context extensions, lifecycle hooks, and contributed tools/resources/prompts.

## When to Use This Skill

### Must Use

- Adding cross-cutting behavior (logging, caching, auth) that applies across multiple tools
- Extending `ExecutionContextBase` with new properties accessible via `this.propertyName` in tools
- Contributing injectable providers that tools or other plugins depend on

### Recommended

- Building a configurable module with runtime options using the `DynamicPlugin` pattern
- Extending the `@Tool` decorator metadata with custom fields (e.g., audit, approval)
- Composing multiple related providers, hooks, and tools into a single installable unit

### Skip When

- You only need lifecycle hooks without providers or context extensions (see `create-plugin-hooks`)
- You want to use an existing official plugin (see `official-plugins`)
- You need to generate tools from an external API spec (see `create-adapter`)

> **Decision:** Use this skill when you need a reusable module that bundles providers, context extensions, or contributed entries and registers them via `@Plugin`.

## Plugin Decorator Signature

```typescript
function Plugin(metadata: PluginMetadata): ClassDecorator;
```

The `PluginMetadata` interface:

```typescript
interface PluginMetadata {
  name: string;
  id?: string;
  description?: string;
  providers?: ProviderType[];
  exports?: ProviderType[];
  plugins?: PluginType[];
  adapters?: AdapterType[];
  tools?: ToolType[];
  resources?: ResourceType[];
  prompts?: PromptType[];
  skills?: SkillType[];
  scope?: 'app' | 'server'; // default: 'app'
  contextExtensions?: ContextExtension[];
}

interface ContextExtension {
  property: string;
  token: Token<unknown>;
  errorMessage?: string;
}
```

## DynamicPlugin Base Class

For plugins that accept runtime configuration, extend `DynamicPlugin<TOptions, TInput>`:

```typescript
abstract class DynamicPlugin<TOptions extends object, TInput extends object = TOptions> {
  static dynamicProviders?(options: any): readonly ProviderType[];
  static init<TThis>(options: InitOptions<TInput>): PluginReturn<TOptions>;
  get<T>(token: Reference<T>): T;
}
```

- `TOptions` -- the resolved options type (after parsing/defaults)
- `TInput` -- the input type users provide to `init()` (may have optional fields)
- `init()` creates a provider entry for use in `plugins: [...]` arrays
- `dynamicProviders()` returns providers computed from the input options

## Quick Start: Minimal DynamicPlugin

The simplest working plugin needs three files: a provider, the plugin class, and registration.

```typescript
// my-greeter.provider.ts
import { Provider } from '@frontmcp/sdk';

@Provider()
export class GreeterService {
  greet(name: string): string {
    return `Hello, ${name}`;
  }
}
```

```typescript
// my-greeter.plugin.ts
import { Plugin, DynamicPlugin, ProviderType } from '@frontmcp/sdk';
import { GreeterService } from './providers/my-greeter.provider';

@Plugin({ name: 'greeter', exports: [GreeterService] })
export default class GreeterPlugin extends DynamicPlugin<{ prefix: string }> {
  static override dynamicProviders(opts: { prefix: string }): ProviderType[] {
    return [{ provide: GreeterService, useFactory: () => new GreeterService() }];
  }
}
```

```typescript
// server.ts
import { FrontMcp } from '@frontmcp/sdk';
import GreeterPlugin from './plugins/my-greeter.plugin';

@FrontMcp({
  info: { name: 'my-server', version: '1.0.0' },
  plugins: [GreeterPlugin.init({ prefix: 'Hi' })],
})
class MyServer {}
```

## Step 1: Create a Simple Plugin

The minimal plugin only needs a name:

```typescript
import { Plugin } from '@frontmcp/sdk';

@Plugin({
  name: 'audit-log',
  description: 'Logs tool executions for audit compliance',
})
export default class AuditLogPlugin {}
```

Register it in your server:

```typescript
import { FrontMcp, App } from '@frontmcp/sdk';
import AuditLogPlugin from './plugins/audit-log.plugin';

@App({ name: 'MyApp' })
class MyApp {}

@FrontMcp({
  info: { name: 'my-server', version: '1.0.0' },
  apps: [MyApp],
  plugins: [AuditLogPlugin],
  tools: [
    /* your tools */
  ],
})
class MyServer {}
```

## Step 2: Add Providers

Plugins contribute injectable services via `providers`:

```typescript
import { Plugin, Provider } from '@frontmcp/sdk';
import type { Token } from '@frontmcp/sdk';

export const AuditLoggerToken: Token<AuditLogger> = Symbol('AuditLogger');

@Provider()
class AuditLogger {
  async logToolCall(toolName: string, userId: string, input: unknown): Promise<void> {
    console.log(`[AUDIT] ${userId} called ${toolName}`, input);
  }
}

@Plugin({
  name: 'audit-log',
  description: 'Logs tool executions for audit compliance',
  providers: [{ provide: AuditLoggerToken, useClass: AuditLogger }],
  exports: [AuditLogger],
})
export default class AuditLogPlugin {}
```

## Step 3: Add Context Extensions

Context extensions add properties to `ExecutionContextBase` so tools access plugin services via `this.propertyName`. Two parts are required:

### Part A: TypeScript Type Declaration (Module Augmentation)

```typescript
// audit-log.context-extension.ts
import type { AuditLogger } from './audit-logger';

declare module '@frontmcp/sdk' {
  interface ExecutionContextBase {
    /** Audit logger provided by AuditLogPlugin */
    readonly auditLog: AuditLogger;
  }
}
```

### Part B: Register via Plugin Metadata

The SDK handles runtime installation when you declare `contextExtensions` in plugin metadata. Do not modify `ExecutionContextBase.prototype` directly.

```typescript
import { Plugin } from '@frontmcp/sdk';
import type { Token } from '@frontmcp/sdk';
import './audit-log.context-extension'; // Import for type augmentation side effect

export const AuditLoggerToken: Token<AuditLogger> = Symbol('AuditLogger');

@Plugin({
  name: 'audit-log',
  description: 'Logs tool executions for audit compliance',
  providers: [{ provide: AuditLoggerToken, useClass: AuditLogger }],
  contextExtensions: [
    {
      property: 'auditLog',
      token: AuditLoggerToken,
      errorMessage: 'AuditLogPlugin is not installed. Add it to your @FrontMcp plugins array.',
    },
  ],
})
export default class AuditLogPlugin {}
```

Now tools can use `this.auditLog`:

```typescript
import { Tool, ToolContext } from '@frontmcp/sdk';

@Tool({ name: 'delete_record' })
class DeleteRecordTool extends ToolContext {
  async execute(input: { recordId: string }) {
    await this.auditLog.logToolCall('delete_record', this.scope.userId, input);
    return { deleted: true };
  }
}
```

## Step 4: Create a Configurable Plugin with DynamicPlugin

For plugins that accept runtime options, extend `DynamicPlugin`:

```typescript
import { Plugin, DynamicPlugin, ProviderType } from '@frontmcp/sdk';
import type { Token } from '@frontmcp/sdk';

export interface MyPluginOptions {
  endpoint: string;
  refreshIntervalMs: number;
}

export type MyPluginOptionsInput = Omit<MyPluginOptions, 'refreshIntervalMs'> & {
  refreshIntervalMs?: number;
};

export const MyServiceToken: Token<MyService> = Symbol('MyService');

@Plugin({
  name: 'my-plugin',
  description: 'A configurable plugin',
  contextExtensions: [
    {
      property: 'myService',
      token: MyServiceToken,
      errorMessage: 'MyPlugin is not installed.',
    },
  ],
})
export default class MyPlugin extends DynamicPlugin<MyPluginOptions, MyPluginOptionsInput> {
  options: MyPluginOptions;

  constructor(options: MyPluginOptionsInput = { endpoint: '' }) {
    super();
    this.options = { refreshIntervalMs: 30_000, ...options };
  }

  static override dynamicProviders(options: MyPluginOptionsInput): ProviderType[] {
    return [
      {
        provide: MyServiceToken,
        useFactory: () =>
          new MyService({
            refreshIntervalMs: 30_000,
            ...options,
          }),
      },
    ];
  }
}
```

Register with `init()`:

```typescript
@FrontMcp({
  info: { name: 'my-server', version: '1.0.0' },
  apps: [MyApp],
  plugins: [
    MyPlugin.init({
      endpoint: 'https://api.example.com',
      refreshIntervalMs: 60_000,
    }),
  ],
})
class MyServer {}
```

## Step 5: Extend Metadata and Execution Context

FrontMCP provides two extension mechanisms for plugins: **metadata augmentation** (add fields to decorators) and **context extensions** (add properties to `this` in tools/resources/prompts).

### All Extensible Metadata Interfaces

Plugins can extend these `declare global` interfaces to add custom fields to any decorator:

| Interface                                | Decorator                  | Example Field                |
| ---------------------------------------- | -------------------------- | ---------------------------- |
| `ExtendFrontMcpToolMetadata`             | `@Tool({...})`             | `audit: { enabled: true }`   |
| `ExtendFrontMcpAgentMetadata`            | `@Agent({...})`            | Inherits from ToolMetadata   |
| `ExtendFrontMcpResourceMetadata`         | `@Resource({...})`         | `cache: { ttl: 3600 }`       |
| `ExtendFrontMcpResourceTemplateMetadata` | `@ResourceTemplate({...})` | `rateLimit: { max: 100 }`    |
| `ExtendFrontMcpPromptMetadata`           | `@Prompt({...})`           | `category: 'onboarding'`     |
| `ExtendFrontMcpJobMetadata`              | `@Job({...})`              | `priority: 'high'`           |
| `ExtendFrontMcpWorkflowMetadata`         | `@Workflow({...})`         | `retryPolicy: 'exponential'` |
| `ExtendFrontMcpSkillMetadata`            | `@Skill({...})`            | `complexity: 'advanced'`     |
| `ExtendFrontMcpLoggerMetadata`           | Logger transports          | `destination: 'sentry'`      |

### Metadata Extension Pattern

Add custom fields to any decorator via `declare global`:

```typescript
// my-plugin.types.ts
declare global {
  interface ExtendFrontMcpToolMetadata {
    audit?: {
      enabled: boolean;
      level: 'info' | 'warn' | 'critical';
    };
  }
}
```

Tools then use the custom field directly in the decorator:

```typescript
@Tool({
  name: 'delete_user',
  audit: { enabled: true, level: 'critical' },
})
class DeleteUserTool extends ToolContext {
  /* ... */
}
```

The same pattern works for any of the 9 interfaces above — replace `ExtendFrontMcpToolMetadata` with the target interface.

### Context Extension Pattern

Add properties like `this.myService` to execution contexts. This requires both TypeScript augmentation and runtime registration.

**Part A: TypeScript type declaration** (in a separate `.context-extension.ts` file):

```typescript
// my-plugin.context-extension.ts
import type { MyService } from './providers/my-service.provider';

declare module '@frontmcp/sdk' {
  interface ExecutionContextBase {
    readonly myService: MyService;
  }
  // PromptContext has a separate prototype chain — augment it too
  interface PromptContext {
    readonly myService: MyService;
  }
}
```

**Part B: Runtime registration** (in the `@Plugin` metadata):

```typescript
@Plugin({
  name: 'my-plugin',
  providers: [MyServiceProvider],
  contextExtensions: [
    {
      property: 'myService',
      token: MyServiceToken,
      errorMessage: 'MyPlugin is not installed. Add it to your app plugins.',
    },
  ],
})
export class MyPlugin extends DynamicPlugin<MyPluginOptions> {
  /* ... */
}
```

The SDK installs lazy getters on both `ExecutionContextBase.prototype` and `PromptContext.prototype` that resolve the DI token on first access.

### ContextExtension Interface

Each entry in the `contextExtensions` array has these fields:

| Field          | Type             | Required | Description                                   |
| -------------- | ---------------- | -------- | --------------------------------------------- |
| `property`     | `string`         | Yes      | Property name accessible as `this.{property}` |
| `token`        | `Token<unknown>` | Yes      | DI token to resolve when property is accessed |
| `errorMessage` | `string`         | No       | Custom error when plugin is not installed     |

### Side-Effect Import

The TypeScript augmentation file must be imported somewhere in your plugin's barrel export so the type declarations take effect:

```typescript
// index.ts
import './my-plugin.context-extension'; // side-effect import for type augmentation
export { MyPlugin } from './my-plugin.plugin';
export { MyServiceToken } from './my-plugin.symbols';
```

---

## Official Plugins

For official plugin installation, configuration, and examples, see the **official-plugins** skill. FrontMCP provides 6 official plugins: CodeCall, Remember, Approval, Cache, Feature Flags, and Dashboard. Install individually or via `@frontmcp/plugins` (meta-package).

## Recommended Folder Structure

```text
plugins/
  my-plugin/
    index.ts                          # Barrel exports: plugin, tokens, types, side-effect import
    my-plugin.plugin.ts               # Plugin class extending DynamicPlugin
    my-plugin.types.ts                # Options Zod schema, TypeScript types, interfaces
    my-plugin.symbols.ts              # DI tokens: export const MY_TOKEN: Token<T> = Symbol('...')
    my-plugin.context-extension.ts    # Module augmentation (declare module '@frontmcp/sdk')
    providers/
      index.ts                        # Barrel for providers
      my-service.provider.ts          # @Provider class with business logic
      my-store-memory.provider.ts     # In-memory store implementation
      my-store-redis.provider.ts      # Redis store implementation (optional)
    tools/                            # Optional — only if plugin provides tools
      index.ts
      my-action.tool.ts               # @Tool class registered via @Plugin({ tools: [...] })
    __tests__/
      my-plugin.spec.ts               # Plugin tests
```

**Key files explained:**

- `index.ts` — Must import the context extension file as a side effect: `import './my-plugin.context-extension'`
- `symbols.ts` — All DI tokens in one place. Other files import from here, not from the plugin class
- `context-extension.ts` — `declare module '@frontmcp/sdk' { interface ExecutionContextBase { readonly myProp: T } }`
- `plugin.ts` — The `@Plugin()` decorated class. Lists `providers`, `exports`, `contextExtensions`, `tools`

## Common Patterns

| Pattern                        | Correct                                                                                        | Incorrect                                                             | Why                                                                          |
| ------------------------------ | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Context extension registration | `contextExtensions: [{ property: 'auditLog', token: AuditLoggerToken }]` in metadata           | `Object.defineProperty(ExecutionContextBase.prototype, ...)` manually | SDK handles runtime installation; manual modification causes ordering issues |
| Type augmentation              | `declare module '@frontmcp/sdk' { interface ExecutionContextBase { ... } }` in a separate file | Skipping the augmentation and casting `this` in tools                 | Without augmentation, TypeScript cannot type-check `this.auditLog`           |
| Provider types                 | `Token<AuditLogger> = Symbol('AuditLogger')` with typed token                                  | `provide: Symbol('AuditLogger')` without type annotation              | Typed tokens enable compile-time DI resolution checking                      |
| Plugin scope                   | `scope: 'app'` (default) for app-scoped behavior                                               | `scope: 'server'` when hooks should only apply to one app             | Server scope fires hooks for all apps in a gateway; default to app           |
| Dynamic options                | Extend `DynamicPlugin<TOptions, TInput>` with `static dynamicProviders()`                      | Constructing providers in the constructor body                        | `dynamicProviders` runs before instantiation, enabling proper DI wiring      |

## Verification Checklist

### Configuration

- [ ] `@Plugin` decorator has `name` and `description`
- [ ] Providers are listed in `providers` array with typed tokens
- [ ] Exported providers are listed in `exports` array
- [ ] Context extensions have `property`, `token`, and `errorMessage` fields

### Type Safety

- [ ] Module augmentation file exists with `declare module '@frontmcp/sdk'` block
- [ ] Augmented properties are `readonly` on `ExecutionContextBase`
- [ ] `PromptContext` is augmented alongside `ExecutionContextBase` for context extensions
- [ ] `declare global` block exists for each metadata extension interface used
- [ ] Augmentation file is imported (side-effect import) in the plugin barrel export

### Runtime

- [ ] Plugin is registered in `plugins` array of `@FrontMcp` or `@App`
- [ ] `this.propertyName` resolves correctly in tool contexts
- [ ] Missing plugin produces a clear error message (from `errorMessage`)
- [ ] Dynamic plugin options are validated in `dynamicProviders()`

## Troubleshooting

| Problem                                              | Cause                                            | Solution                                                                                                                                                                                                                                   |
| ---------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `this.auditLog` has type `any` or is unrecognized    | Module augmentation file not imported            | Add side-effect import: `import './audit-log.context-extension'` in plugin file                                                                                                                                                            |
| Circular dependency error at startup                 | Calling `installExtension()` at module top level | Remove manual installation; use `contextExtensions` metadata array instead                                                                                                                                                                 |
| Provider not found in tool context                   | Provider not listed in plugin `exports`          | Add the provider to both `providers` and `exports` arrays                                                                                                                                                                                  |
| Hooks fire for unrelated apps in gateway             | Plugin `scope` set to `'server'`                 | Change to `scope: 'app'` (default) unless server-wide behavior is intended                                                                                                                                                                 |
| `DynamicPlugin.init()` options ignored               | Overriding constructor without calling `super()` | Ensure constructor calls `super()` and merges defaults properly                                                                                                                                                                            |
| `ProviderNotRegisteredError` for context extension   | Token in `contextExtensions` not in `providers`  | Ensure the token used in `contextExtensions[].token` is registered in the plugin's `providers` array. Use `{ provide: MyToken, useClass: MyService }` or list the class directly. If using `dynamicProviders()`, return the provider there |
| Provider works in tools but not in context extension | Using class reference instead of Symbol token    | Create a typed `Token<T> = Symbol('name')` in `symbols.ts`, use it in both `providers` and `contextExtensions`. Direct class references can fail if not constructable without dependencies                                                 |

## Reference

- [Plugin System Documentation](https://docs.agentfront.dev/frontmcp/plugins/creating-plugins)
- Related skills: `create-plugin-hooks`, `official-plugins`, `create-adapter`, `create-provider`
