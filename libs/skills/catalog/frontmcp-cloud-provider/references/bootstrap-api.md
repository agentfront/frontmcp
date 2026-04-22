---
name: bootstrap-api
description: The asynchronous initialization hook that runs after the scope is ready. Fetches tenant-managed config and populates the shared CloudRuntimeContext.
tags: [cloud, bootstrap, runtime-context, feature-flags, async]
---

# `cloudProvider.bootstrap(ctx)`

## Signature

```typescript
interface CloudProvider {
  bootstrap?(ctx: CloudBootstrapContext): Promise<void>;
}

interface CloudBootstrapContext {
  options: CloudOptions;
  runtime: CloudRuntimeContext;
  logger: {
    info(msg: string, meta?: Record<string, unknown>): void;
    warn(msg: string, meta?: Record<string, unknown>): void;
    debug(msg: string, meta?: Record<string, unknown>): void;
    error(msg: string, meta?: Record<string, unknown>): void;
  };
}
```

Called **after** `scopes.ready` resolves. At this point every plugin, provider, and adapter from your `contribute()` has been instantiated and DI works. You can make HTTP calls, subscribe to events, and populate the runtime context.

## Contract

| Property     | Rule                                                                                                                                                                |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Optional     | Skip the method entirely if you have no runtime work                                                                                                                |
| Errors       | SDK catches and logs; **server still starts**. If you need hard-fail, validate in `contribute()` instead                                                            |
| Blocking     | The server's `start()` waits for bootstrap to resolve. Keep it fast — kick off timers, register webhooks, but don't block on slow background work                   |
| Reentrancy   | Called once per `FrontMcpInstance`. Not called on hot reload                                                                                                        |
| Cancellation | No AbortSignal today. If you start timers, unref them and clean up on scope dispose (you don't get a dispose hook yet — use `AbortController` on `process` signals) |

## `CloudRuntimeContext` API

```typescript
interface CloudRuntimeContext {
  get<T = unknown>(key: string): T | undefined;
  isEnabled(key: string): boolean;
  set<T = unknown>(key: string, value: T): void;
  merge(values: Record<string, unknown>): void;
  snapshot(): Record<string, unknown>;
}
```

Everything the cloud publishes ends up here. The SDK registers this as a global DI provider under `CloudRuntimeContextToken` so every tool, hook, and adapter can read it.

## Key-naming convention

Use `<your-cloud-name>.<concept>` so multiple cloud providers can coexist without collisions:

| Key                             | Value                     | Used by                                               |
| ------------------------------- | ------------------------- | ----------------------------------------------------- |
| `yourcloud.loginUrl`            | `string`                  | Host-side UI plugins                                  |
| `yourcloud.featureFlags`        | `Record<string, boolean>` | Bulk reads                                            |
| `yourcloud.features.<flagName>` | `boolean`                 | `runtime.isEnabled('yourcloud.features.newCheckout')` |
| `yourcloud.corsOrigins`         | `string[]`                | CORS middleware                                       |
| `yourcloud.connectivity`        | Your checker instance     | Health probe / debug                                  |
| `yourcloud.healthProbe`         | `{ name, check() }`       | Forwarded to `/healthz`                               |

Publishing both a bulk object AND per-item keys is the standard pattern — consumers pick whichever is ergonomic.

## Canonical pattern: parallel fetch with per-fetcher fallback

```typescript
async bootstrap(ctx) {
  const client = new YourCloudClient(ctx.options);

  const [flags, corsOrigins, loginUrl] = await Promise.all([
    client.getFeatureFlags().catch((e) => {
      ctx.logger.warn('yourcloud: flags fetch failed', { error: err(e) });
      return {} as Record<string, boolean>;
    }),
    client.getCorsAllowlist().catch((e) => {
      ctx.logger.debug('yourcloud: cors fetch failed', { error: err(e) });
      return [] as string[];
    }),
    client.getLoginUrl().catch(() => undefined),
  ]);

  ctx.runtime.set('yourcloud.featureFlags', flags);
  ctx.runtime.set('yourcloud.corsOrigins', corsOrigins);
  if (loginUrl) ctx.runtime.set('yourcloud.loginUrl', loginUrl);
  for (const [k, v] of Object.entries(flags)) {
    ctx.runtime.set(`yourcloud.features.${k}`, Boolean(v));
  }

  ctx.logger.info('yourcloud: bootstrap complete', {
    flags: Object.keys(flags).length,
    origins: corsOrigins.length,
    hasLoginUrl: Boolean(loginUrl),
  });
}
```

Why parallel: bootstrap is in the server-startup critical path. Three sequential 200ms fetches costs 600ms; parallel costs 200ms.

Why `.catch` per fetch: one 404 (e.g. your tenant doesn't have feature flags configured yet) shouldn't blank out the CORS allowlist. Partial degradation > complete failure.

## Runtime context cleanup — known limitation

`CloudRuntimeContext` does **not** currently expose `delete(key)` and the
SDK does **not** call a dispose hook on your cloud provider when the host
shuts down. That means:

- Timers you start in `bootstrap()` must be `.unref()`'d so they don't
  prevent process exit.
- Keys you `set()` remain in the context for the process lifetime. If you
  need "removed" semantics, set the key to `undefined` or a sentinel value
  and have consumers check both presence AND value.
- Tests that instantiate multiple `FrontMcpInstance`s in the same process
  must do their own cleanup (stop your timers, close your clients). The
  skill's `shared-http-client` reference shows how to expose a test-only
  `clearCache()` helper.

A future SDK release is expected to add `dispose()` on the provider
interface and `delete(key)` on the runtime context. Track the contract
changes in your package's SDK peer-dep range.

## Running periodic work

Use `setInterval` with `.unref?.()` so the timer doesn't prevent process exit:

```typescript
async bootstrap(ctx) {
  const timer = setInterval(async () => {
    try {
      const fresh = await client.getFeatureFlags();
      ctx.runtime.set('yourcloud.featureFlags', fresh);
    } catch (e) {
      ctx.logger.debug('yourcloud: periodic refresh failed', { error: err(e) });
    }
  }, 60_000);
  timer.unref?.();

  // Clean-up helper: register via runtime so tests / dispose paths can stop it
  ctx.runtime.set('yourcloud.__internal.refreshTimer', timer);
}
```

## Publishing a health probe

FrontMCP's `/healthz` endpoint accepts arbitrary probes. If your cloud runs a connectivity checker, expose it:

```typescript
const connectivity = new YourConnectivityChecker({ options: ctx.options });
await connectivity.start();
ctx.runtime.set('yourcloud.healthProbe', connectivity.asHealthProbe());

// In your plugin's registration, contribute a health probe that reads
// this runtime key — see frontmcp-production-readiness for the pattern.
```

## Reading runtime-context from tools

Consumers inject the token and read keys:

```typescript
import { CloudRuntimeContextToken, Tool, ToolContext, type CloudRuntimeContext } from '@frontmcp/sdk';

@Tool({ name: 'export-data' })
class ExportTool extends ToolContext {
  async execute(input: Input) {
    // @Tool has no `providers` field; inject inside execute() via this.get().
    const runtime = this.get<CloudRuntimeContext>(CloudRuntimeContextToken);
    if (!runtime.isEnabled('yourcloud.features.dataExport')) {
      throw new FeatureDisabledError('data export is disabled for this tenant');
    }
    // ...
  }
}
```

## Error handling

| Scenario                            | Do                                                                           | Don't                                                            |
| ----------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Auth endpoint 401 (bad credentials) | `ctx.logger.error(...)` and set a runtime flag `yourcloud.authFailed = true` | Throw — SDK logs but absent runtime flag means tools can't react |
| Network timeout                     | `.catch` → fallback value + `logger.warn`                                    | Let it propagate and abort bootstrap                             |
| Parse error on response             | Log + use default                                                            | Return `undefined` without logging — makes debugging impossible  |
| Missing optional endpoint           | `logger.debug` at most                                                       | `logger.warn` — operators get alert fatigue                      |

## Helper

```typescript
function err(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
```

## Examples

| Example                                                         | Level    | Description                                                                                                                                                                                                                                           |
| --------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`full-lifecycle`](../examples/bootstrap-api/full-lifecycle.md) | Advanced | Shows an end-to-end CloudProvider that contributes plugins plus an options override synchronously, then bootstraps by fetching three remote configs in parallel and publishing feature flags, CORS allowlist, and login URL into the runtime context. |

## Reference

- Source: `libs/sdk/src/front-mcp/front-mcp.ts` (`runCloudBootstrap`)
- `CloudRuntimeContext` impl: `libs/sdk/src/common/types/options/cloud/runtime-context.ts`
