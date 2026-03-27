---
name: create-plugin
description: Build a FrontMCP plugin with lifecycle hooks and context extensions. Use when creating custom plugins, extending tool context, or adding cross-cutting concerns.
tags:
  - plugins
  - extensibility
  - hooks
  - context
bundle:
  - full
visibility: both
priority: 5
parameters:
  - name: plugin-name
    description: Name for the new plugin (kebab-case)
    type: string
    required: true
  - name: with-context-extension
    description: Whether the plugin adds properties to ExecutionContextBase
    type: boolean
    required: false
    default: false
  - name: with-dynamic-options
    description: Whether the plugin accepts runtime configuration options
    type: boolean
    required: false
    default: false
examples:
  - scenario: Create a simple logging plugin with no context extensions
    parameters:
      plugin-name: audit-log
      with-context-extension: false
    expected-outcome: A plugin that hooks into tool execution to log audit events
  - scenario: Create an advanced plugin that extends ToolContext with a new property
    parameters:
      plugin-name: feature-flags
      with-context-extension: true
      with-dynamic-options: true
    expected-outcome: A configurable plugin that adds this.featureFlags to all tool contexts
license: MIT
compatibility: Requires Node.js 18+ and @frontmcp/sdk
metadata:
  category: plugins
  difficulty: advanced
  docs: https://docs.agentfront.dev/frontmcp/plugins/creating-plugins
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

@App()
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

## Step 5: Extend Tool Metadata

Plugins can add fields to the `@Tool` decorator via global augmentation:

```typescript
declare global {
  interface ExtendFrontMcpToolMetadata {
    audit?: {
      enabled: boolean;
      level: 'info' | 'warn' | 'critical';
    };
  }
}
```

Tools then use it:

```typescript
@Tool({
  name: 'delete_user',
  audit: { enabled: true, level: 'critical' },
})
class DeleteUserTool extends ToolContext {
  /* ... */
}
```

---

## Official Plugins

For official plugin installation, configuration, and examples, see the **official-plugins** skill. FrontMCP provides 6 official plugins: CodeCall, Remember, Approval, Cache, Feature Flags, and Dashboard. Install individually or via `@frontmcp/plugins` (meta-package).

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
- [ ] Augmentation file is imported (side-effect import) in the plugin module

### Runtime

- [ ] Plugin is registered in `plugins` array of `@FrontMcp` or `@App`
- [ ] `this.propertyName` resolves correctly in tool contexts
- [ ] Missing plugin produces a clear error message (from `errorMessage`)
- [ ] Dynamic plugin options are validated in `dynamicProviders()`

## Troubleshooting

| Problem                                           | Cause                                            | Solution                                                                        |
| ------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------- |
| `this.auditLog` has type `any` or is unrecognized | Module augmentation file not imported            | Add side-effect import: `import './audit-log.context-extension'` in plugin file |
| Circular dependency error at startup              | Calling `installExtension()` at module top level | Remove manual installation; use `contextExtensions` metadata array instead      |
| Provider not found in tool context                | Provider not listed in plugin `exports`          | Add the provider to both `providers` and `exports` arrays                       |
| Hooks fire for unrelated apps in gateway          | Plugin `scope` set to `'server'`                 | Change to `scope: 'app'` (default) unless server-wide behavior is intended      |
| `DynamicPlugin.init()` options ignored            | Overriding constructor without calling `super()` | Ensure constructor calls `super()` and merges defaults properly                 |

## Reference

- [Plugin System Documentation](https://docs.agentfront.dev/frontmcp/plugins/creating-plugins)
- Related skills: `create-plugin-hooks`, `official-plugins`, `create-adapter`, `create-provider`
