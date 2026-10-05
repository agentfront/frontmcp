---
name: plugin-with-context-extension
reference: create-plugin
level: intermediate
description: 'A plugin that adds a `this.auditLog` property to all execution contexts using context extensions and module augmentation.'
tags: [development, sdk, plugin, context, extension]
features:
  - "Defining a typed DI token with `Token<T> = Symbol('...')` in a dedicated symbols file"
  - 'Binding the token with a named factory provider and listing that same definition in `providers` and `exports`'
  - "Module augmentation via `declare module '@frontmcp/sdk'` to add `readonly auditLog` to `ExecutionContextBase` and `PromptContext`"
  - 'Registering `contextExtensions` in `@Plugin` metadata with `property`, `token`, and `errorMessage`'
  - 'Side-effect import of the context extension file in both the plugin and the barrel export'
  - 'Accessing the extended property (`this.auditLog`) in a tool, with the caller identity from `this.auth.user.sub`'
---

# Plugin with Context Extension

A plugin that adds a `this.auditLog` property to all execution contexts using context extensions and module augmentation.

## Code

```typescript
// src/plugins/audit-log/providers/audit-logger.provider.ts
export class AuditLogger {
  async logToolCall(toolName: string, subject: string, input: unknown): Promise<void> {
    console.log(`[AUDIT] ${subject} called ${toolName}`, input);
  }
}
```

```typescript
// src/plugins/audit-log/audit-log.symbols.ts
import type { Token } from '@frontmcp/sdk';

import type { AuditLogger } from './providers/audit-logger.provider';

export const AuditLoggerToken: Token<AuditLogger> = Symbol('audit-log:logger');
```

```typescript
// src/plugins/audit-log/audit-log.context-extension.ts
import type { AuditLogger } from './providers/audit-logger.provider';

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

```typescript
// src/plugins/audit-log/audit-log.plugin.ts
import { Plugin, type ProviderType } from '@frontmcp/sdk';

import { AuditLoggerToken } from './audit-log.symbols';
import { AuditLogger } from './providers/audit-logger.provider';

import './audit-log.context-extension';

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

```typescript
// src/plugins/audit-log/index.ts
import './audit-log.context-extension';

export { default as AuditLogPlugin } from './audit-log.plugin';
export { AuditLoggerToken } from './audit-log.symbols';
```

```typescript
// src/tools/delete-record.tool.ts
import { Tool, ToolContext, z } from '@frontmcp/sdk';

@Tool({
  name: 'delete_record',
  description: 'Delete a record and write an audit entry',
  inputSchema: { recordId: z.string() },
})
export class DeleteRecordTool extends ToolContext {
  async execute(input: { recordId: string }) {
    // this.auditLog is available because AuditLogPlugin is installed
    await this.auditLog.logToolCall('delete_record', this.auth.user.sub, input);
    return { deleted: true };
  }
}
```

```typescript
// src/server.ts
import { App, FrontMcp } from '@frontmcp/sdk';

import { AuditLogPlugin } from './plugins/audit-log';
import { DeleteRecordTool } from './tools/delete-record.tool';

@App({ name: 'Records', tools: [DeleteRecordTool], plugins: [AuditLogPlugin] })
class RecordsApp {}

@FrontMcp({
  info: { name: 'records-server', version: '1.0.0' },
  apps: [RecordsApp],
})
export default class Server {}
```

`providers` and `exports` take provider definitions, not bare tokens: `exports: [AuditLoggerToken]` throws when `@Plugin` runs (`providers items must be annotated with @Provider()`). Every provider object needs a `name`, whether it binds the token with `useFactory` (as here), `useClass` or `useValue`. The tool reaches `AuditLoggerToken` (and so `this.auditLog`) only because the plugin exports that definition to the app. The caller's identity comes from `this.auth.user.sub`; `this.scope` is the server scope, not the user.

## What This Demonstrates

- Defining a typed DI token with `Token<T> = Symbol('...')` in a dedicated symbols file
- Binding the token with a named factory provider and listing that same definition in `providers` and `exports`
- Module augmentation via `declare module '@frontmcp/sdk'` to add `readonly auditLog` to `ExecutionContextBase` and `PromptContext`
- Registering `contextExtensions` in `@Plugin` metadata with `property`, `token`, and `errorMessage`
- Side-effect import of the context extension file in both the plugin and the barrel export
- Accessing the extended property (`this.auditLog`) in a tool, with the caller identity from `this.auth.user.sub`

## Related

- See `create-plugin` for the full context extension pattern, metadata extensions, and DynamicPlugin
