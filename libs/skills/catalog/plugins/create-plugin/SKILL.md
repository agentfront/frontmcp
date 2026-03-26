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

## Common Mistakes

- **Module-level side effects for context extension** -- do not call `installExtension()` at the top level of a module. This causes circular dependencies. The SDK handles installation via `contextExtensions` metadata.
- **Forgetting the type augmentation** -- without `declare module '@frontmcp/sdk'`, TypeScript will not recognize `this.auditLog` in tools.
- **Using `any` types in providers** -- use `unknown` for generic defaults.
- **Scope confusion** -- `scope: 'server'` makes hooks fire for all apps in a gateway. Default to `scope: 'app'`.
- **Direct prototype modification** -- use the `contextExtensions` metadata array instead of directly modifying `ExecutionContextBase.prototype`.

## Reference

- Plugin system docs: [docs.agentfront.dev/frontmcp/plugins/creating-plugins](https://docs.agentfront.dev/frontmcp/plugins/creating-plugins)
- `@Plugin` decorator: import from `@frontmcp/sdk` — [source](https://github.com/agentfront/frontmcp/tree/main/libs/sdk/src/common/decorators/plugin.decorator.ts)
- `DynamicPlugin` base class: import from `@frontmcp/sdk` — [source](https://github.com/agentfront/frontmcp/tree/main/libs/sdk/src/common/dynamic/dynamic.plugin.ts)
- `PluginMetadata` interface (contextExtensions): import from `@frontmcp/sdk` — [source](https://github.com/agentfront/frontmcp/tree/main/libs/sdk/src/common/metadata/plugin.metadata.ts)
- Official plugins: `@frontmcp/plugin-cache`, `@frontmcp/plugin-codecall`, `@frontmcp/plugin-remember`, `@frontmcp/plugin-approval`, `@frontmcp/plugin-feature-flags`, `@frontmcp/plugin-dashboard`
- Meta-package: `@frontmcp/plugins` (re-exports cache, codecall, dashboard, remember)
