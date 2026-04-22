---
name: runtime-context-keys
description: Key-naming conventions and access patterns for CloudRuntimeContext — where to publish what, how consumers read it via DI.
tags: [cloud, runtime, feature-flags, di, conventions]
---

# Runtime Context Key Conventions

The SDK registers `CloudRuntimeContext` as a singleton global DI provider (`CloudRuntimeContextToken`) so every tool, hook, resource, and adapter can inject it and read the values your `bootstrap()` published.

## Naming conventions

Always prefix keys with your cloud name to prevent collisions between multiple cloud providers installed simultaneously.

### ✅ Good

```typescript
ctx.runtime.set('yourcloud.loginUrl', 'https://auth.yourcloud.example');
ctx.runtime.set('yourcloud.featureFlags', { newCheckout: true });
ctx.runtime.set('yourcloud.features.newCheckout', true);
ctx.runtime.set('yourcloud.corsOrigins', ['https://a', 'https://b']);
ctx.runtime.set('yourcloud.tenant.id', 'tenant-42');
ctx.runtime.set('yourcloud.connectivity', connectivityChecker);
```

### ❌ Bad

```typescript
ctx.runtime.set('loginUrl', '...');              // no cloud prefix — collides
ctx.runtime.set('features', {...});              // too generic
ctx.runtime.set('yourcloud.newCheckout', true);  // implicit "features" namespace
ctx.runtime.set('__yourcloud_internal', ...);    // users read everything — don't smuggle internals
```

## Dual-publish feature flags

Always publish both the bulk object AND per-flag boolean keys so consumers can pick the ergonomic access pattern for their case.

```typescript
const flags = await client.getFeatureFlags();
// flags = { newCheckout: true, aiAssist: false, experimentalSearch: true }

ctx.runtime.set('yourcloud.featureFlags', flags); // bulk

for (const [name, enabled] of Object.entries(flags)) {
  ctx.runtime.set(`yourcloud.features.${name}`, Boolean(enabled)); // per-flag
}
```

Consumers:

```typescript
// Option A — ergonomic via isEnabled (per-flag key)
if (runtime.isEnabled('yourcloud.features.newCheckout')) { ... }

// Option B — bulk read (when listing flags in an admin UI)
const allFlags = runtime.get<Record<string, boolean>>('yourcloud.featureFlags');
for (const [name, enabled] of Object.entries(allFlags ?? {})) { ... }
```

## Publishing health probes

FrontMCP's `/healthz` picks up probes contributed by plugins. Expose yours under a consistent key:

```typescript
const connectivity = new YourConnectivityChecker(...);
await connectivity.start();
ctx.runtime.set('yourcloud.healthProbe', connectivity.asHealthProbe());
ctx.runtime.set('yourcloud.connectivity', connectivity);  // full instance for debugging
```

Your plugin's contribution registers a FrontMCP health probe that reads `yourcloud.healthProbe` and forwards the check result. See `frontmcp-production-readiness` for the plugin side.

## Publishing the audit emitter

Match the Frontegg pattern: expose a lightweight emit() interface for host tools that want to log audits in your cloud's schema.

```typescript
import { createAuditEmitter } from '@your-org/plugin-yourcloud';

ctx.runtime.set('yourcloud.audit', createAuditEmitter(telemetryDispatcher));
ctx.runtime.set('yourcloud.telemetry', telemetryDispatcher); // full handle
```

Consumers:

```typescript
const audit = runtime.get<AuditEmitter>('yourcloud.audit');
audit?.emit({
  type: 'tool.call',
  kind: 'security',
  action: 'invoke',
  result: 'success',
  resource: { type: 'tool', id: 'export-data' },
});
```

## Accessing runtime context from tools

```typescript
import { CloudRuntimeContextToken, Tool, ToolContext, type CloudRuntimeContext } from '@frontmcp/sdk';

@Tool({ name: 'checkout' })
class CheckoutTool extends ToolContext {
  async execute(input: InferInput): Promise<Output> {
    // Inject at execute() time — @Tool does NOT accept a `providers` field.
    const runtime = this.get<CloudRuntimeContext>(CloudRuntimeContextToken);

    if (!runtime.isEnabled('yourcloud.features.newCheckout')) {
      throw new FeatureDisabledError('new-checkout is disabled for this tenant');
    }

    const loginUrl = runtime.get<string>('yourcloud.loginUrl');
    // ...
  }
}
```

**Gotcha:** consumers may run BEFORE your `bootstrap()` completes (e.g. a tool called during server warmup, or before any async bootstrap finishes). Always handle `undefined`:

```typescript
// ✅ Defensive
const loginUrl = runtime.get<string>('yourcloud.loginUrl') ?? 'https://default.example';

// ❌ Brittle — throws with no useful error when bootstrap is slow
const loginUrl = runtime.get<string>('yourcloud.loginUrl')!;
```

## Namespace hygiene for multi-cloud

If a customer installs TWO cloud providers (you + some other integration), keys namespaced to each cloud coexist cleanly. The `CloudRuntimeContext` is a flat key-value map — there's no isolation between providers. Don't:

- Publish un-prefixed keys
- Overwrite another cloud's keys
- Read another cloud's keys (structurally fragile; use their own public API if available)

## Inheriting host storage instead of declaring your own

When your cloud provider needs persistent state (approval decisions, webhook
correlation, session-scoped caches), **don't** introduce a fresh `storage`
option on your cloud config. Inherit the host's `@FrontMcp({ redis: { ... } })`
via DI — the same pattern `RememberPlugin`, `CachePlugin`, and the
Frontegg plugin use.

```typescript
import { FrontMcpConfig, type FrontMcpConfigType } from '@frontmcp/sdk';
import { createStorage, createMemoryStorage } from '@frontmcp/utils';

static override dynamicProviders = (options: CloudOptions): ProviderType[] => [
  {
    name: 'yourcloud:store',
    provide: YourStoreToken,
    inject: () => [FrontMcpConfig] as const,
    useFactory: async (hostConfig: FrontMcpConfigType) => {
      // If the host configured redis at the top level, ride on it.
      if (hostConfig.redis) {
        return createStorage({ type: 'redis', redis: { config: hostConfig.redis } });
      }
      // Otherwise fall back to env auto-detect, then memory.
      try { return await createStorage({ type: 'auto' }); }
      catch { return createMemoryStorage(); }
    },
  },
];
```

Consumers set redis ONCE at the top level and everything — sessions,
elicitations, jobs, YOUR cloud — rides on the same adapter. The Frontegg
plugin exports `resolveFronteggStorage` as a ready-made helper for this
pattern; reuse it or copy the shape.

## Update cadence

If a key's value changes over time (e.g. feature flags refreshed on a timer), overwrite with `set()`:

```typescript
// In your periodic refresh:
setInterval(async () => {
  const flags = await client.getFeatureFlags();
  ctx.runtime.set('yourcloud.featureFlags', flags);
  for (const [name, enabled] of Object.entries(flags)) {
    ctx.runtime.set(`yourcloud.features.${name}`, Boolean(enabled));
  }
}, 60_000).unref?.();
```

No invalidation mechanism — readers see the current value on every `get()`. If a flag is DELETED by the backend, `set('yourcloud.features.removed', false)` and eventually delete the key (the runtime context doesn't have `delete()` in v1; overwrite with a sentinel).

## Key catalog template

Document your cloud's published keys in your README so consumers know what to consume:

| Key                         | Type                      | Purpose                                        |
| --------------------------- | ------------------------- | ---------------------------------------------- |
| `yourcloud.loginUrl`        | `string`                  | Hosted login URL (host UIs)                    |
| `yourcloud.featureFlags`    | `Record<string, boolean>` | Bulk feature flags                             |
| `yourcloud.features.<flag>` | `boolean`                 | Per-flag ergonomic access                      |
| `yourcloud.corsOrigins`     | `string[]`                | Managed CORS allowlist                         |
| `yourcloud.tenant.id`       | `string`                  | Current tenant ID from the cloud's perspective |
| `yourcloud.audit`           | `AuditEmitter`            | Host-facing audit emitter                      |
| `yourcloud.telemetry`       | `TelemetryDispatcher`     | Full dispatcher for flush/close                |
| `yourcloud.connectivity`    | `ConnectivityChecker`     | Health + latency diagnostics                   |
| `yourcloud.healthProbe`     | `{ name, check() }`       | Forwarded to `/healthz`                        |

## Reference

- `CloudRuntimeContext` implementation: `libs/sdk/src/common/types/options/cloud/runtime-context.ts`
- DI token: `CloudRuntimeContextToken` exported from `@frontmcp/sdk`
- Frontegg's published keys (reference implementation): see `frontegg.cloud-provider.ts` in `@frontmcp/plugin-frontegg`
