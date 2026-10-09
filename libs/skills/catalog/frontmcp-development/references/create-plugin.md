---
name: create-plugin
description: Build plugins with providers, context extensions, lifecycle hooks, and contributed tools
---

# Create a FrontMCP Plugin

This skill covers building custom plugins for FrontMCP and using all 7 official plugins. Plugins are modular units that extend server behavior through providers, context extensions, lifecycle hooks, and contributed tools/resources/prompts.

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
  scope?: 'app' | 'server'; // where hooks run; default: 'app'
  contextExtensions?: ContextExtension[];
  enforcesMetadata?: string[];
  dynamicSkills?: boolean;
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
  static dynamicTools?(options: any): readonly ToolType[];
  static init<TThis>(options: InitOptions<TInput>): PluginReturn<TOptions>;
  get<T>(token: Reference<T>): T;
}
```

- `TOptions` -- the resolved options type (after parsing/defaults)
- `TInput` -- the input type users provide to `init()` (may have optional fields)
- `init()` creates a provider entry for use in `plugins: [...]` arrays
- `dynamicProviders()` returns providers computed from the input options
- `dynamicTools()` returns tools computed from the input options

## Quick Start: Minimal DynamicPlugin

The simplest working plugin needs three files: a service, the plugin class, and registration.

```typescript
// plugins/greeter/greeter.service.ts
export class GreeterService {
  constructor(private readonly prefix: string) {}

  greet(name: string): string {
    return `${this.prefix}, ${name}`;
  }
}
```

```typescript
// plugins/greeter/greeter.plugin.ts
import { DynamicPlugin, Plugin, type ProviderType } from '@frontmcp/sdk';

import { GreeterService } from './greeter.service';

export interface GreeterPluginOptions {
  prefix: string;
}

@Plugin({ name: 'greeter', description: 'Greets people with a configurable prefix' })
export default class GreeterPlugin extends DynamicPlugin<GreeterPluginOptions> {
  static override dynamicProviders(options: GreeterPluginOptions): ProviderType[] {
    return [{ name: 'greeter:service', provide: GreeterService, useFactory: () => new GreeterService(options.prefix) }];
  }
}
```

```typescript
// server.ts
import { App, FrontMcp, Tool, ToolContext, z } from '@frontmcp/sdk';

import GreeterPlugin from './plugins/greeter/greeter.plugin';
import { GreeterService } from './plugins/greeter/greeter.service';

@Tool({ name: 'greet', inputSchema: { name: z.string() } })
class GreetTool extends ToolContext {
  async execute(input: { name: string }) {
    return { message: this.get(GreeterService).greet(input.name) };
  }
}

@App({ name: 'Main', tools: [GreetTool] })
class MainApp {}

@FrontMcp({
  info: { name: 'my-server', version: '1.0.0' },
  apps: [MainApp],
  plugins: [GreeterPlugin.init({ prefix: 'Hi' })],
})
class MyServer {}
```

A provider that `dynamicProviders()` returns reaches the apps the plugin is installed for without an `exports` entry, so `GreetTool` resolves `GreeterService` directly. Every provider object needs a `name`; `GreeterService` is built by the factory, so it needs no `@Provider` decorator.

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
import { App, FrontMcp } from '@frontmcp/sdk';

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

### Hook scope: `'app'` or `'server'`

`@Plugin({ scope })` decides where the plugin's hooks run, not where its providers live:

- `'app'` (default): the hooks run for the entries of the app (or server) that installs the plugin.
- `'server'`: the hooks run for every app's entries, even when the plugin is declared on a single `@App`. Its providers and context extensions stay with the app that installs it. A standalone app (`standalone: true`) cannot install a server-scoped plugin (`InvalidPluginScopeError`).

## Step 2: Add Providers

Plugins contribute injectable services via `providers`, and make them visible to the host app with `exports`:

```typescript
import { Plugin, type ProviderType, type Token } from '@frontmcp/sdk';

export class AuditLogger {
  async logToolCall(toolName: string, subject: string, input: unknown): Promise<void> {
    console.log(`[AUDIT] ${subject} called ${toolName}`, input);
  }
}

export const AuditLoggerToken: Token<AuditLogger> = Symbol('audit-log:logger');

const auditLoggerProvider: ProviderType = {
  name: 'audit-log:logger',
  provide: AuditLoggerToken,
  useFactory: () => new AuditLogger(),
};

@Plugin({
  name: 'audit-log',
  description: 'Logs tool executions for audit compliance',
  providers: [auditLoggerProvider],
  exports: [auditLoggerProvider],
})
export default class AuditLogPlugin {}
```

A tool in the host app then resolves `this.get(AuditLoggerToken)`.

- `@Plugin({ providers, exports })` accepts a class decorated with `@Provider({ name })` (for example `providers: [AuditLogger], exports: [AuditLogger]`), or a provider object with a `name`: `{ name, provide, useFactory, inject? }`, `{ name, provide, useClass }` or `{ name, provide, useValue }`. `inject: () => [Dep] as const` is only needed when the factory takes dependencies.
- `exports` lists provider definitions from `providers`, never a bare token: `exports: [AuditLoggerToken]` throws when `@Plugin` runs (`providers items must be annotated with @Provider()`). A provider object without `name` is rejected the same way.
- `@Provider` metadata is strict: `name` is required, and `id`, `description` and `scope` (`ProviderScope.GLOBAL`, the default, or `ProviderScope.CONTEXT` for one instance per request) are the only other keys. A bare `@Provider()` throws.
- Without `exports`, a provider from `@Plugin({ providers })` is visible only inside the plugin (its hooks, tools and `this.get()`). Providers returned by `dynamicProviders()` reach the host app without it.

### A provider that needs the scope

A plugin has no `this.scope`. To work with the server's registries, inject `ScopeEntry` into a factory provider, as the WebMCP plugin does:

```typescript
import { Plugin, ScopeEntry, type ProviderType } from '@frontmcp/sdk';

export class ToolCatalog {
  constructor(private readonly scope: ScopeEntry) {}

  toolNames(): string[] {
    return this.scope.tools.getTools().map((tool) => tool.metadata.name);
  }
}

const toolCatalogProvider: ProviderType = {
  name: 'tool-catalog:catalog',
  provide: ToolCatalog,
  inject: () => [ScopeEntry] as const,
  useFactory: (scope: ScopeEntry) => new ToolCatalog(scope),
};

@Plugin({ name: 'tool-catalog', providers: [toolCatalogProvider], exports: [toolCatalogProvider] })
export default class ToolCatalogPlugin {}
```

The factory runs while the scope initializes, before its tools are registered: read the registries when a method is called (as above), or wait for `scope.ready` before acting on them. Inside a hook, `flowCtx.get(ScopeEntry)` returns the same scope.

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
  // PromptContext does not extend ExecutionContextBase, so augment it too
  interface PromptContext {
    readonly auditLog: AuditLogger;
  }
}
```

### Part B: Register via Plugin Metadata

The SDK handles runtime installation when you declare `contextExtensions` in plugin metadata. Do not modify `ExecutionContextBase.prototype` directly.

```typescript
// audit-log.plugin.ts
import { Plugin, type ProviderType, type Token } from '@frontmcp/sdk';

import { AuditLogger } from './audit-logger';

import './audit-log.context-extension'; // Import for type augmentation side effect

export const AuditLoggerToken: Token<AuditLogger> = Symbol('audit-log:logger');

const auditLoggerProvider: ProviderType = {
  name: 'audit-log:logger',
  provide: AuditLoggerToken,
  useFactory: () => new AuditLogger(),
};

@Plugin({
  name: 'audit-log',
  description: 'Logs tool executions for audit compliance',
  providers: [auditLoggerProvider],
  exports: [auditLoggerProvider],
  contextExtensions: [
    {
      property: 'auditLog',
      token: AuditLoggerToken,
      errorMessage: 'AuditLogPlugin is not installed. Add it to the plugins array of your @App or @FrontMcp.',
    },
  ],
})
export default class AuditLogPlugin {}
```

The property resolves `token` from the tool's own providers, so the plugin must make the token visible to the app: export the provider definition (as here) or return it from `dynamicProviders()`.

Now tools can use `this.auditLog`. The caller's identity is on `this.auth` (`this.scope` is the server scope, not the user):

```typescript
import { Tool, ToolContext, z } from '@frontmcp/sdk';

@Tool({ name: 'delete_record', inputSchema: { recordId: z.string() } })
class DeleteRecordTool extends ToolContext {
  async execute(input: { recordId: string }) {
    await this.auditLog.logToolCall('delete_record', this.auth.user.sub, input);
    return { deleted: true };
  }
}
```

## Step 4: Create a Configurable Plugin with DynamicPlugin

For plugins that accept runtime options, extend `DynamicPlugin`:

```typescript
import { DynamicPlugin, Plugin, type ProviderType, type Token } from '@frontmcp/sdk';

import { MyService } from './providers/my-service.provider';

export interface MyPluginOptions {
  endpoint: string;
  refreshIntervalMs: number;
}

export type MyPluginOptionsInput = Omit<MyPluginOptions, 'refreshIntervalMs'> & {
  refreshIntervalMs?: number;
};

export function resolveMyPluginOptions(input: MyPluginOptionsInput): MyPluginOptions {
  return { ...input, refreshIntervalMs: input.refreshIntervalMs ?? 30_000 };
}

export const MyServiceToken: Token<MyService> = Symbol('my-plugin:service');

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
  readonly options: MyPluginOptions;

  constructor(options: MyPluginOptionsInput) {
    super();
    this.options = resolveMyPluginOptions(options);
  }

  static override dynamicProviders(options: MyPluginOptionsInput): ProviderType[] {
    const resolved = resolveMyPluginOptions(options);
    return [{ name: 'my-plugin:service', provide: MyServiceToken, useFactory: () => new MyService(resolved) }];
  }
}
```

`MyService` is a plain class (`constructor(options: MyPluginOptions)`) built by the factory, so it needs no `@Provider` decorator.

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

Listing the class itself (`plugins: [MyPlugin]`) is the same as `MyPlugin.init()`: the constructor, `dynamicProviders` and `dynamicTools` all get `{}`, so the plugin installs the providers and tools its default options give. A plugin that validates required options at runtime fails at startup with its own error; TypeScript types alone validate nothing, so a plugin without such a check starts with `{}`. Up to 1.9.3 the class form got none of the option-derived providers or tools (`plugins: [CodeCallPlugin]` served no tools; `plugins: [RememberPlugin]` failed on the first `this.remember`).

### Option-derived providers are registered before nested plugins

`dynamicProviders(options)` and `init({ providers })` are registered **before** the plugin's nested `plugins` are built, for both `init(options)` and `init({ useFactory, inject? })` (the factory runs first). A nested plugin can inject them:

```typescript
@Plugin({
  name: 'my-plugin',
  plugins: [
    AuditPlugin.init({
      inject: () => [MyServiceToken],
      useFactory: (service: MyService) => ({ channel: service.auditChannel }),
    }),
  ],
})
export default class MyPlugin extends DynamicPlugin<MyPluginOptions, MyPluginOptionsInput> {
  /* dynamicProviders() returns MyServiceToken as above */
}
```

The reverse does not work: an option-derived provider cannot inject a provider that a nested plugin exports.

`inject` is optional in `init({ useFactory })`: give it only when the factory takes dependencies, as `AuditPlugin.init` does here.

### Options named like plugin metadata, and option-derived tools

`init(options)` spreads the options into the plugin's metadata, so an option named like a list-valued metadata key (`tools`, `resources`, `prompts`, `skills`, `adapters`, `plugins`, `exports`, `contextExtensions`, `enforcesMetadata`) used to be read as that list: `RememberPlugin.init({ tools: { enabled: true } })` crashed at startup. A non-array value under one of those keys is now an option and stays out of the metadata; an array still contributes.

No other option reaches the metadata: `name`, `id`, `description` and `scope` options stay the plugin's own and reach the instance, so `MyPlugin.init({ name: 'eu', scope: 'tenant' })` keeps the `@Plugin` name and install scope (up to 1.9.1 they renamed the plugin or set its scope). Set `name` and `scope` in `@Plugin`.

`providers` follows the same rule: an array adds providers to the plugin; any other value (`MyPlugin.init({ providers: { region: 'eu' } })`) is the plugin's own option and reaches the instance instead of throwing `(extraProviders ?? []) is not iterable` at module load. When the options type declares `providers`, `init()` types the key as that option.

To register tools only when an option asks for it, declare `static dynamicTools(options)`, the counterpart of `dynamicProviders`. Its tools are added to those from `@Plugin({ tools })` and from an array `tools` option:

```typescript
export default class MemoryPlugin extends DynamicPlugin<MemoryOptions, MemoryOptionsInput> {
  static override dynamicTools = (options: MemoryOptionsInput): readonly ToolType[] =>
    options.tools?.enabled ? [RememberTool, RecallTool] : [];
}
```

`dynamicTools`, like `dynamicProviders`, runs on the options the plugin is built with: those given to `init(options)`, the ones an `init({ useFactory })` factory returns at startup, or `{}` when the plugin is listed as its class (`plugins: [MemoryPlugin]`). `RememberPlugin.init({ useFactory: () => ({ type: 'memory', tools: { enabled: true } }) })`, which needs no `inject` because the factory takes no dependencies, therefore registers the memory tools.

### Installing the same plugin in several apps

Each app that installs a plugin gets its own copy of the plugin's providers, including CONTEXT-scoped ones. Tools, resources and prompts resolve the nearest definition in their own hierarchy (plugin, then app, then server). So `this.myService` in app A uses A's options even when app B installs `MyPlugin.init()` with different options:

```typescript
@App({
  id: 'billing',
  name: 'Billing',
  plugins: [MyPlugin.init({ endpoint: 'https://billing.example.com' })],
  tools: [RefundTool],
})
class BillingApp {}

@App({ id: 'ops', name: 'Ops', plugins: [MyPlugin.init({ endpoint: 'https://ops.example.com' })], tools: [DeployTool] })
class OpsApp {}
```

An app that does not install the plugin does not get its providers: there, `this.get(Token)` throws and `this.tryGet(Token)` returns `undefined`. Install the plugin on the server (`@FrontMcp({ plugins })`) to share it with every app. Up to 1.8.7 the providers a plugin derives from its options (`dynamicProviders(options)`, `init({ providers })`) leaked to every other app on the server.

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
export interface AuditMetadata {
  enabled: boolean;
  level: 'info' | 'warn' | 'critical';
}

declare global {
  interface ExtendFrontMcpToolMetadata {
    audit?: AuditMetadata;
  }
}
```

`declare global` only works in a module: the file must import or export something, or TypeScript rejects the augmentation (TS2669).

Tools then use the custom field directly in the decorator:

```typescript
@Tool({
  name: 'delete_user',
  inputSchema: { userId: z.string() },
  audit: { enabled: true, level: 'critical' },
})
class DeleteUserTool extends ToolContext {
  async execute(input: { userId: string }) {
    return { deleted: input.userId };
  }
}
```

A plugin hook reads the field from the tool's metadata: `flowCtx.state.toolContext?.metadata.audit` in a `@ToolHook` method that receives `flowCtx: FlowCtxOf<'tools:call-tool'>` (see the `configurable-dynamic-plugin` example).

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
  contextExtensions: [
    {
      property: 'myService',
      token: MyServiceToken,
      errorMessage: 'MyPlugin is not installed. Add it to your app plugins.',
    },
  ],
})
export class MyPlugin extends DynamicPlugin<MyPluginOptions, MyPluginOptionsInput> {
  // dynamicProviders() returns { name, provide: MyServiceToken, useFactory } as in Step 4
}
```

The SDK installs lazy getters on both `ExecutionContextBase.prototype` and `PromptContext.prototype` that resolve the DI token on first access, from the context's own providers. A token registered in `@Plugin({ providers })` must also be listed in `exports` (Step 2) to resolve there.

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

For official plugin installation, configuration, and examples, see the **official-plugins** skill. FrontMCP provides 7 official plugins: CodeCall, Remember, Approval, Cache, Feature Flags, Dashboard, and WebMCP. Install individually or via `@frontmcp/plugins` (meta-package).

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

| Pattern                        | Correct                                                                                              | Incorrect                                                             | Why                                                                                                |
| ------------------------------ | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Context extension registration | `contextExtensions: [{ property: 'auditLog', token: AuditLoggerToken }]` in metadata                 | `Object.defineProperty(ExecutionContextBase.prototype, ...)` manually | SDK handles runtime installation; manual modification causes ordering issues                       |
| Type augmentation              | `declare module '@frontmcp/sdk' { interface ExecutionContextBase { ... } }` in a separate file       | Skipping the augmentation and casting `this` in tools                 | Without augmentation, TypeScript cannot type-check `this.auditLog`                                 |
| Provider types                 | `Token<AuditLogger> = Symbol('AuditLogger')` with typed token                                        | `provide: Symbol('AuditLogger')` without type annotation              | Typed tokens enable compile-time DI resolution checking                                            |
| Exporting a provider           | `providers: [auditLoggerProvider], exports: [auditLoggerProvider]`                                   | `exports: [AuditLoggerToken]`, or a provider object without `name`    | `exports` takes named provider definitions; the other forms throw at decoration                    |
| Caller identity in a tool      | `this.auth.user.sub`                                                                                 | `this.scope.userId`                                                   | `this.scope` is the server scope; the user is on `this.auth`                                       |
| Plugin scope                   | `scope: 'app'` (default) for app-scoped behavior                                                     | `scope: 'server'` when hooks should only apply to one app             | Server scope fires hooks for every app's entries, even when declared on one `@App`; default to app |
| Dynamic options                | Extend `DynamicPlugin<TOptions, TInput>` with `static dynamicProviders()`                            | Constructing providers in the constructor body                        | `dynamicProviders` runs before instantiation, enabling proper DI wiring                            |
| Nested plugin needs options    | Nested `Plugin.init({ inject: () => [HostToken], useFactory })` injecting a `dynamicProviders` token | Resolving the host's option-derived provider by reading global state  | Option-derived providers are registered before nested plugins are built                            |

## Verification Checklist

### Configuration

- [ ] `@Plugin` decorator has `name` and `description`
- [ ] Providers are listed in `providers` array with typed tokens
- [ ] Exported providers are listed in `exports` array as the same definitions, not bare tokens
- [ ] Every provider object has a `name`, and every `@Provider` decorator passes `{ name }`
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

| Problem                                                                                                                  | Cause                                                                                                                         | Solution                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `this.auditLog` has type `any` or is unrecognized                                                                        | Module augmentation file not imported                                                                                         | Add side-effect import: `import './audit-log.context-extension'` in plugin file                                                             |
| Circular dependency error at startup                                                                                     | Calling `installExtension()` at module top level                                                                              | Remove manual installation; use `contextExtensions` metadata array instead                                                                  |
| Provider not found in tool context                                                                                       | Provider not listed in plugin `exports`                                                                                       | List the same provider definition in both `providers` and `exports` (the definition, not its token), or return it from `dynamicProviders()` |
| Hooks fire for unrelated apps in gateway                                                                                 | Plugin `scope` set to `'server'`                                                                                              | Change to `scope: 'app'` (default) unless server-wide behavior is intended                                                                  |
| `DynamicPlugin.init()` options ignored                                                                                   | Overriding constructor without calling `super()`                                                                              | Ensure constructor calls `super()` and merges defaults properly                                                                             |
| `this.auditLog` throws your `errorMessage` although the plugin is installed                                              | The token is registered in `@Plugin({ providers })` but not exported, so the app cannot resolve it                            | Add the provider definition to `exports`, or return it from `dynamicProviders()`                                                            |
| `@Plugin invalid metadata for "providers"` or `providers items must be annotated with @Provider()` when the module loads | A bare token in `exports`, a provider object (`useFactory`, `useClass` or `useValue`) without `name`, or an undecorated class | Use a `@Provider({ name })` class or a provider object with a `name` (`{ name, provide, useFactory }`), and export that same definition     |
| Error thrown where a provider class is declared                                                                          | Bare `@Provider()`: `name` is required                                                                                        | `@Provider({ name: 'my-plugin:service' })`, optionally with `description` and `scope: ProviderScope.CONTEXT`                                |

## Examples

| Example                                                                                       | Level        | Description                                                                                                               |
| --------------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------- |
| [`basic-plugin-with-provider`](../examples/create-plugin/basic-plugin-with-provider.md)       | Basic        | A minimal plugin that contributes an injectable service via the `providers` and `exports` arrays.                         |
| [`configurable-dynamic-plugin`](../examples/create-plugin/configurable-dynamic-plugin.md)     | Advanced     | A plugin that accepts runtime configuration via `DynamicPlugin` and extends decorator metadata with custom fields.        |
| [`plugin-with-context-extension`](../examples/create-plugin/plugin-with-context-extension.md) | Intermediate | A plugin that adds a `this.auditLog` property to all execution contexts using context extensions and module augmentation. |

> See all examples in [`examples/create-plugin/`](../examples/create-plugin/)

## Reference

- [Plugin System Documentation](https://docs.agentfront.dev/frontmcp/plugins/creating-plugins)
- Related skills: `create-plugin-hooks`, `official-plugins`, `create-adapter`, `create-provider`
