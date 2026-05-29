---
name: registration
description: @App({ tools }) vs @FrontMcp({ tools }), multi-app composition.
---

# Registering tools

## Best practice — register in `@App`

```typescript
// src/apps/main/index.ts
import { App } from '@frontmcp/sdk';

import { AddNumbersTool, GreetUserTool, SearchDocumentsTool } from './tools';

@App({
  name: 'main',
  tools: [GreetUserTool, SearchDocumentsTool, AddNumbersTool],
})
export class MainApp {}
```

```typescript
// src/main.ts
import { FrontMcp } from '@frontmcp/sdk';

import { MainApp } from './apps/main';

@FrontMcp({
  info: { name: 'demo', version: '1.0.0' },
  apps: [MainApp],
})
export default class DemoServer {}
```

Apps provide:

- **Modularity** — each app is a self-contained surface; you can install / uninstall / disable apps without touching the others.
- **Per-app auth** — different apps can use different `auth: { mode: 'public' | 'transparent' | 'local' | 'remote' }`.
- **Per-app providers** — DI tokens registered in `@App({ providers })` are visible only to tools in that app.
- **Per-app lifecycle hooks** — `onAppStart`, `onAppStop`, etc.

## Escape hatch — top-level `@FrontMcp({ tools })`

For single-app servers, you can register tools directly on `@FrontMcp` instead of declaring an `@App`:

```typescript
@FrontMcp({
  info: { name: 'demo', version: '1.0.0' },
  tools: [GreetUserTool, SearchDocumentsTool],
})
export default class DemoServer {}
```

`@FrontMcp` accepts the same arrays as `@App`: `tools`, `resources`, `prompts`, `providers`, `plugins`, `jobs`, `channels`, `authorities`, `skills`.

Use this for prototypes / very small servers. Promote to an `@App` as soon as you want any of the per-app benefits above.

See [`rules/register-in-app.md`](../rules/register-in-app.md).

## Multi-app composition

Real-world servers have multiple apps. Each app owns its own tools, providers, and (optionally) auth mode:

```typescript
@FrontMcp({
  info: { name: 'company-mcp', version: '1.0.0' },
  apps: [PublicApp, AuthenticatedApp, AdminApp],
})
export default class CompanyServer {}

@App({
  name: 'public',
  auth: { mode: 'public', anonymousScopes: ['read:public'] },
  tools: [SearchPublicDocsTool],
})
class PublicApp {}

@App({
  name: 'authenticated',
  auth: { mode: 'remote', clientId: process.env.OAUTH_CLIENT_ID },
  tools: [GetMyProfileTool, UpdateMyProfileTool],
})
class AuthenticatedApp {}

@App({
  name: 'admin',
  auth: { mode: 'remote', requiredScopes: ['admin'] },
  tools: [DeleteUserTool, GrantRoleTool],
})
class AdminApp {}
```

Tool names must be unique **across the whole server** — even though they live in different apps. The tool name is the lookup key in `tools/call`.

## Tool sharing across apps

Same tool registered in two apps:

```typescript
@App({ name: 'public',        tools: [SearchTool] })
@App({ name: 'authenticated', tools: [SearchTool] })
```

This is fine — the tool instance is constructed per-scope. Each app sees its own. But you'll want different names if the auth posture differs:

```typescript
@App({ name: 'public',        tools: [SearchPublicTool] })
@App({ name: 'authenticated', tools: [SearchPrivateTool] })
```

## Conditional registration

For tools that should only register in certain envs:

```typescript
@App({
  name: 'main',
  tools: [
    GreetUserTool,
    ...(process.env.NODE_ENV !== 'production' ? [DebugTool] : []),
  ],
})
```

Better — use `availableWhen: { env: ['development', 'test'] }` on the tool itself. Same effect, plus the constraint is self-documenting on the tool.

## See also

- [`rules/register-in-app.md`](../rules/register-in-app.md)
- [`availability.md`](./availability.md)
- `architecture` skill — multi-app patterns, module boundaries, scope / DI tokens
