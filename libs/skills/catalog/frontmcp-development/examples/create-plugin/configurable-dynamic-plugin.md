---
name: configurable-dynamic-plugin
reference: create-plugin
level: advanced
description: 'A plugin that accepts runtime configuration via `DynamicPlugin` and extends decorator metadata with custom fields.'
tags: [development, plugin, configurable, dynamic]
features:
  - 'Extending `DynamicPlugin<TOptions, TInput>` for runtime-configurable plugins'
  - 'Implementing `static dynamicProviders()` to create providers from the input options'
  - 'Using `TInput` with optional fields and applying defaults in the constructor'
  - 'Extending decorator metadata via `declare global { interface ExtendFrontMcpToolMetadata }`'
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

export const MyServiceToken: Token<MyService> = Symbol('MyService');
```

```typescript
// src/plugins/my-plugin/providers/my-service.provider.ts
import { Provider } from '@frontmcp/sdk';
import type { MyPluginOptions } from '../my-plugin.types';

@Provider()
export class MyService {
  private readonly endpoint: string;
  private readonly refreshIntervalMs: number;

  constructor(options: MyPluginOptions) {
    this.endpoint = options.endpoint;
    this.refreshIntervalMs = options.refreshIntervalMs;
  }

  async query(params: Record<string, unknown>): Promise<unknown> {
    const res = await globalThis.fetch(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    return res.json();
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
import { Plugin, DynamicPlugin, ProviderType } from '@frontmcp/sdk';
import { MyService } from './providers/my-service.provider';
import { MyServiceToken } from './my-plugin.symbols';
import type { MyPluginOptions, MyPluginOptionsInput } from './my-plugin.types';
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

```typescript
// src/server.ts
import { FrontMcp, App, Tool, ToolContext } from '@frontmcp/sdk';
import MyPlugin from './plugins/my-plugin/my-plugin.plugin';

// Tool using the extended metadata field and context extension
@Tool({
  name: 'delete_user',
  audit: { enabled: true, level: 'critical' }, // Custom metadata from ExtendFrontMcpToolMetadata
})
class DeleteUserTool extends ToolContext {
  async execute(input: { userId: string }) {
    const result = await this.myService.query({ action: 'delete', userId: input.userId });
    return result;
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

## What This Demonstrates

- Extending `DynamicPlugin<TOptions, TInput>` for runtime-configurable plugins
- Implementing `static dynamicProviders()` to create providers from the input options
- Using `TInput` with optional fields and applying defaults in the constructor
- Extending decorator metadata via `declare global { interface ExtendFrontMcpToolMetadata }`
- Augmenting both `ExecutionContextBase` and `PromptContext` for full context extension coverage
- Registering the plugin with `MyPlugin.init({ ... })` in the `plugins` array

## Related

- See `create-plugin` for the full list of extensible metadata interfaces and the recommended folder structure
