---
name: configurable-dynamic-plugin
reference: create-plugin
level: advanced
description: 'A plugin that accepts runtime configuration via `DynamicPlugin` and extends decorator metadata with custom fields.'
tags: [development, plugin, configurable, dynamic]
features:
  - 'Extending `DynamicPlugin<TOptions, TInput>` for runtime-configurable plugins'
  - 'Implementing `static dynamicProviders()` to return a named factory provider built from the input options'
  - 'Using `TInput` with optional fields and resolving defaults in one helper shared by the constructor and `dynamicProviders()`'
  - 'Extending decorator metadata via `declare global { interface ExtendFrontMcpToolMetadata }`'
  - 'Reading the custom metadata in a `@ToolHook.Did` hook that receives the flow context (`FlowCtxOf`)'
  - 'Augmenting both `ExecutionContextBase` and `PromptContext` for full context extension coverage'
  - 'Registering the plugin with `MyPlugin.init({ ... })` in the `plugins` array'
---

# Configurable Plugin with DynamicPlugin and Metadata Extension

A plugin that accepts runtime configuration via `DynamicPlugin` and extends decorator metadata with custom fields.

## Code

```typescript
// src/plugins/my-plugin/my-plugin.types.ts
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

// Extend the @Tool decorator metadata with a custom field
declare global {
  interface ExtendFrontMcpToolMetadata {
    audit?: {
      enabled: boolean;
      level: 'info' | 'warn' | 'critical';
    };
  }
}
```

```typescript
// src/plugins/my-plugin/my-plugin.symbols.ts
import type { Token } from '@frontmcp/sdk';

import type { MyService } from './providers/my-service.provider';

export const MyServiceToken: Token<MyService> = Symbol('my-plugin:service');
```

```typescript
// src/plugins/my-plugin/providers/my-service.provider.ts
import type { MyPluginOptions } from '../my-plugin.types';

export class MyService {
  constructor(private readonly options: MyPluginOptions) {}

  async query(params: Record<string, unknown>): Promise<unknown> {
    const res = await globalThis.fetch(this.options.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    return res.json();
  }

  async reportAuditedCall(toolName: string, level: 'info' | 'warn' | 'critical'): Promise<void> {
    await this.query({ action: 'audit', toolName, level });
  }
}
```

```typescript
// src/plugins/my-plugin/my-plugin.context-extension.ts
import type { MyService } from './providers/my-service.provider';

declare module '@frontmcp/sdk' {
  interface ExecutionContextBase {
    readonly myService: MyService;
  }
  interface PromptContext {
    readonly myService: MyService;
  }
}
```

```typescript
// src/plugins/my-plugin/my-plugin.plugin.ts
import { DynamicPlugin, Plugin, ToolHook, type FlowCtxOf, type ProviderType } from '@frontmcp/sdk';

import { MyServiceToken } from './my-plugin.symbols';
import { resolveMyPluginOptions, type MyPluginOptions, type MyPluginOptionsInput } from './my-plugin.types';
import { MyService } from './providers/my-service.provider';

import './my-plugin.context-extension';

@Plugin({
  name: 'my-plugin',
  description: 'A configurable plugin with context extensions',
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
    return [
      {
        name: 'my-plugin:service',
        provide: MyServiceToken,
        useFactory: () => new MyService(resolved),
      },
    ];
  }

  @ToolHook.Did('execute')
  async reportAuditedCall(flowCtx: FlowCtxOf<'tools:call-tool'>): Promise<void> {
    const toolContext = flowCtx.state.toolContext;
    const audit = toolContext?.metadata.audit;
    if (!toolContext || !audit?.enabled) return;
    await this.get(MyServiceToken).reportAuditedCall(toolContext.metadata.name, audit.level);
  }
}
```

```typescript
// src/server.ts
import { App, FrontMcp, Tool, ToolContext, z } from '@frontmcp/sdk';

import MyPlugin from './plugins/my-plugin/my-plugin.plugin';

// Tool using the extended metadata field and context extension
@Tool({
  name: 'delete_user',
  inputSchema: { userId: z.string() },
  audit: { enabled: true, level: 'critical' }, // Custom metadata from ExtendFrontMcpToolMetadata
})
class DeleteUserTool extends ToolContext {
  async execute(input: { userId: string }) {
    const result = await this.myService.query({ action: 'delete', userId: input.userId });
    return { result };
  }
}

@App({ name: 'MyApp', tools: [DeleteUserTool] })
class MyApp {}

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

Providers that `dynamicProviders()` returns reach the apps the plugin is installed for without an `exports` entry, which is why `this.myService` resolves in `DeleteUserTool`. Each provider needs a `name`; `inject` is optional and only needed when the factory takes dependencies. Inside the plugin, `this.get(token)` resolves from the plugin's own providers.

## What This Demonstrates

- Extending `DynamicPlugin<TOptions, TInput>` for runtime-configurable plugins
- Implementing `static dynamicProviders()` to return a named factory provider built from the input options
- Using `TInput` with optional fields and resolving defaults in one helper shared by the constructor and `dynamicProviders()`
- Extending decorator metadata via `declare global { interface ExtendFrontMcpToolMetadata }`
- Reading the custom metadata in a `@ToolHook.Did` hook that receives the flow context (`FlowCtxOf`)
- Augmenting both `ExecutionContextBase` and `PromptContext` for full context extension coverage
- Registering the plugin with `MyPlugin.init({ ... })` in the `plugins` array

## Related

- See `create-plugin` for the full list of extensible metadata interfaces and the recommended folder structure
