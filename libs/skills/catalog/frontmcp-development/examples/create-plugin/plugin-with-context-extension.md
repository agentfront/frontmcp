---
name: plugin-with-context-extension
reference: create-plugin
level: intermediate
description: 'A plugin that adds a `this.auditLog` property to all execution contexts using context extensions and module augmentation.'
tags: [development, sdk, plugin, context, extension]
features:
  - "Defining a typed DI token with `Token<T> = Symbol('...')` in a dedicated symbols file"
  - "Module augmentation via `declare module '@frontmcp/sdk'` to add `readonly auditLog` to `ExecutionContextBase`"
  - 'Registering `contextExtensions` in `@Plugin` metadata with `property`, `token`, and `errorMessage`'
  - 'Side-effect import of the context extension file in both the plugin and the barrel export'
  - 'Accessing the extended property (`this.auditLog`) in tool execution contexts'
---

# Plugin with Context Extension

A plugin that adds a `this.auditLog` property to all execution contexts using context extensions and module augmentation.

## Code

```typescript
// src/plugins/audit-log/audit-log.symbols.ts
import type { Token } from '@frontmcp/sdk';
import type { AuditLogger } from './providers/audit-logger.provider';

export const AuditLoggerToken: Token<AuditLogger> = Symbol('AuditLogger');
```

```typescript
// src/plugins/audit-log/providers/audit-logger.provider.ts
import { Provider } from '@frontmcp/sdk';

@Provider()
export class AuditLogger {
  async logToolCall(toolName: string, userId: string, input: unknown): Promise<void> {
    console.log(`[AUDIT] ${userId} called ${toolName}`, input);
  }
}
```

```typescript
// src/plugins/audit-log/audit-log.context-extension.ts
import type { AuditLogger } from './providers/audit-logger.provider';

declare module '@frontmcp/sdk' {
  interface ExecutionContextBase {
    /** Audit logger provided by AuditLogPlugin */
    readonly auditLog: AuditLogger;
  }
}
```

```typescript
// src/plugins/audit-log/audit-log.plugin.ts
import { Plugin } from '@frontmcp/sdk';
import { AuditLogger } from './providers/audit-logger.provider';
import { AuditLoggerToken } from './audit-log.symbols';
import './audit-log.context-extension'; // Side-effect import for type augmentation

@Plugin({
  name: 'audit-log',
  description: 'Logs tool executions for audit compliance',
  providers: [{ provide: AuditLoggerToken, useClass: AuditLogger }],
  exports: [AuditLoggerToken],
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

```typescript
// src/plugins/audit-log/index.ts
import './audit-log.context-extension'; // Side-effect import for type augmentation
export { default as AuditLogPlugin } from './audit-log.plugin';
export { AuditLoggerToken } from './audit-log.symbols';
```

```typescript
// src/tools/delete-record.tool.ts
import { Tool, ToolContext } from '@frontmcp/sdk';

@Tool({ name: 'delete_record' })
class DeleteRecordTool extends ToolContext {
  async execute(input: { recordId: string }) {
    // this.auditLog is available because AuditLogPlugin is installed
    await this.auditLog.logToolCall('delete_record', this.scope.userId, input);
    return { deleted: true };
  }
}
```

## What This Demonstrates

- Defining a typed DI token with `Token<T> = Symbol('...')` in a dedicated symbols file
- Module augmentation via `declare module '@frontmcp/sdk'` to add `readonly auditLog` to `ExecutionContextBase`
- Registering `contextExtensions` in `@Plugin` metadata with `property`, `token`, and `errorMessage`
- Side-effect import of the context extension file in both the plugin and the barrel export
- Accessing the extended property (`this.auditLog`) in tool execution contexts

## Related

- See `create-plugin` for the full context extension pattern, metadata extensions, and DynamicPlugin
