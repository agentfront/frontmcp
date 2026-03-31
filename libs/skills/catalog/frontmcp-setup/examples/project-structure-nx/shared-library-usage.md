---
name: shared-library-usage
reference: project-structure-nx
level: intermediate
description: 'Create a shared library in an Nx monorepo and use it from multiple apps to avoid cross-app imports.'
tags: [setup, nx, database, structure, shared, library]
features:
  - 'Shared libraries live in `libs/` with barrel `index.ts` exports'
  - 'Both apps import `DatabaseProvider` from the shared library, not from each other'
  - 'Nx dependency graph: `servers/ --> apps/ --> libs/` (apps never import other apps)'
  - 'Path aliases configured in `tsconfig.base.json` keep imports clean (`@my-workspace/shared-utils`)'
---

# Shared Library Between Apps

Create a shared library in an Nx monorepo and use it from multiple apps to avoid cross-app imports.

## Code

```bash
# Generate a shared library
nx g @frontmcp/nx:lib shared-utils
```

```typescript
// libs/shared-utils/src/index.ts
export { formatCurrency } from './format-currency';
export { DatabaseProvider } from './database.provider';
export type { AppConfig } from './app-config.interface';
```

```typescript
// libs/shared-utils/src/database.provider.ts
import { Provider } from '@frontmcp/sdk';

@Provider({ name: 'database' })
export class DatabaseProvider {
  async query(sql: string): Promise<unknown[]> {
    // shared database access logic
    return [];
  }
}
```

```typescript
// libs/shared-utils/src/format-currency.ts
export function formatCurrency(amount: number, currency: string): string {
  return `${currency} ${amount.toFixed(2)}`;
}
```

```typescript
// apps/billing/src/billing.app.ts
import { App } from '@frontmcp/sdk';
import { DatabaseProvider } from '@my-workspace/shared-utils';
import { CreateInvoiceTool } from './tools/create-invoice.tool';

@App({
  name: 'billing',
  tools: [CreateInvoiceTool],
  providers: [DatabaseProvider],
})
export class BillingApp {}
```

```typescript
// apps/crm/src/crm.app.ts
import { App } from '@frontmcp/sdk';
import { DatabaseProvider } from '@my-workspace/shared-utils';
import { LookupUserTool } from './tools/lookup-user.tool';

@App({
  name: 'crm',
  tools: [LookupUserTool],
  providers: [DatabaseProvider],
})
export class CrmApp {}
```

## What This Demonstrates

- Shared libraries live in `libs/` with barrel `index.ts` exports
- Both apps import `DatabaseProvider` from the shared library, not from each other
- Nx dependency graph: `servers/ --> apps/ --> libs/` (apps never import other apps)
- Path aliases configured in `tsconfig.base.json` keep imports clean (`@my-workspace/shared-utils`)

## Related

- See `project-structure-nx` for the full dependency hierarchy and Nx generator commands
