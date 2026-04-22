---
name: full-lifecycle
reference: bootstrap-api
level: advanced
description: 'Shows an end-to-end CloudProvider that contributes plugins plus an options override synchronously, then bootstraps by fetching three remote configs in parallel and publishing feature flags, CORS allowlist, and login URL into the runtime context.'
tags: [cloud, contribute, bootstrap, runtime-context, feature-flags, cors]
features:
  - 'Running a two-phase lifecycle — sync `contribute()` for static injection and async `bootstrap()` for remote config'
  - 'Fetching feature flags, CORS allowlist, and login URL in parallel inside `bootstrap()` with per-fetcher fallback'
  - 'Publishing both a bulk `yourcloud.featureFlags` object and per-flag `yourcloud.features.<name>` keys'
  - 'Sharing a single HTTP client between `contribute()` and `bootstrap()` via a Map keyed on `clientId|domain`'
  - 'Registering an unref`ed periodic refresh timer that updates published feature flags without blocking process exit'
---

# Full-Lifecycle CloudProvider

Shows an end-to-end CloudProvider that contributes plugins plus an options override synchronously, then bootstraps by fetching three remote configs in parallel and publishing feature flags, CORS allowlist, and login URL into the runtime context.

## Code

```typescript
// src/your-cloud.client.ts
import type { CloudOptions } from '@frontmcp/sdk';

export class YourCloudClient {
  constructor(private readonly options: CloudOptions) {}

  async getFeatureFlags(): Promise<Record<string, boolean>> {
    const res = await this.authedGet<Record<string, boolean>>('/api/v1/feature-flags');
    return res ?? {};
  }

  async getCorsAllowlist(): Promise<string[]> {
    const res = await this.authedGet<string[]>('/api/v1/cors-origins');
    return Array.isArray(res) ? res : [];
  }

  async getLoginUrl(): Promise<string | undefined> {
    const res = await this.authedGet<{ url?: string }>('/api/v1/login-config');
    return res?.url;
  }

  private async authedGet<T>(path: string): Promise<T | undefined> {
    const token = await this.getToken();
    const response = await fetch(`https://${this.options.domain}${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`${path} failed: ${response.status}`);
    return response.json() as Promise<T>;
  }

  private async getToken(): Promise<string> {
    // See shared-http-client reference for the client_credentials + refresh-dedupe pattern
    throw new Error('omitted for brevity');
  }
}
```

```typescript
// src/your-cloud.provider.ts
import type { CloudBootstrapContext, CloudContributions, CloudOptions, CloudProvider } from '@frontmcp/sdk';

import { YourCloudClient } from './your-cloud.client.js';
import YourCloudPlugin from './your-cloud.plugin.js';

// The merger (`mergeCloudContributions` in the SDK) spreads metadata into a
// new object, so `ctx.options` in bootstrap() is a DIFFERENT reference than
// the one contribute() saw. Key the cache on a stable string
// (`clientId|domain`) instead of the options object identity.
const clientCache = new Map<string, YourCloudClient>();
function cacheKey(options: Pick<CloudOptions, 'clientId' | 'domain'>): string {
  return `${options.clientId}|${options.domain ?? 'api.frontegg.com'}`;
}
function getOrCreateClient(options: CloudOptions): YourCloudClient {
  const key = cacheKey(options);
  let client = clientCache.get(key);
  if (!client) {
    client = new YourCloudClient(options);
    clientCache.set(key, client);
  }
  return client;
}

function err(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export const cloudProvider: CloudProvider = {
  name: 'yourcloud',

  contribute(options: CloudOptions): CloudContributions {
    if (!options.clientId) throw new Error('[yourcloud] clientId required');
    if (!options.secret) throw new Error('[yourcloud] secret required');

    const client = getOrCreateClient(options);

    // Plug in just options — `DynamicPlugin<CloudOptions>` expects a single
    // options argument. The plugin itself calls `getOrCreateClient(options)`
    // to reach the same client instance, so contribute() and bootstrap()
    // share one token cache without passing the client through init().
    return {
      plugins: [YourCloudPlugin.init(options)],
      optionsOverride: {
        cors: {
          strategy: 'fillGaps',
          value: { origin: [] as string[] },
        },
      },
    };
  },

  async bootstrap(ctx: CloudBootstrapContext): Promise<void> {
    const client = getOrCreateClient(ctx.options);

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
    for (const [name, enabled] of Object.entries(flags)) {
      ctx.runtime.set(`yourcloud.features.${name}`, Boolean(enabled));
    }
    ctx.runtime.set('yourcloud.corsOrigins', corsOrigins);
    if (loginUrl) ctx.runtime.set('yourcloud.loginUrl', loginUrl);

    ctx.logger.info('yourcloud: bootstrap complete', {
      flagCount: Object.keys(flags).length,
      originCount: corsOrigins.length,
      hasLoginUrl: Boolean(loginUrl),
    });

    const timer = setInterval(async () => {
      try {
        const fresh = await client.getFeatureFlags();
        ctx.runtime.set('yourcloud.featureFlags', fresh);
        for (const [name, enabled] of Object.entries(fresh)) {
          ctx.runtime.set(`yourcloud.features.${name}`, Boolean(enabled));
        }
      } catch (e) {
        ctx.logger.debug('yourcloud: periodic refresh failed', { error: err(e) });
      }
    }, 60_000);
    timer.unref?.();
  },
};
```

```typescript
// How a host tool reads the published values
import { CloudRuntimeContextToken, Tool, ToolContext, type CloudRuntimeContext } from '@frontmcp/sdk';

@Tool({ name: 'checkout' })
class CheckoutTool extends ToolContext {
  async execute() {
    // @Tool has no `providers` field; inject via this.get() inside execute().
    const runtime = this.get<CloudRuntimeContext>(CloudRuntimeContextToken);
    if (!runtime.isEnabled('yourcloud.features.newCheckout')) {
      throw new Error('new-checkout disabled for this tenant');
    }
    const loginUrl = runtime.get<string>('yourcloud.loginUrl') ?? 'https://default.example';
    return { loginUrl };
  }
}
```

## What This Demonstrates

- Running a two-phase lifecycle — sync `contribute()` for static injection and async `bootstrap()` for remote config
- Fetching feature flags, CORS allowlist, and login URL in parallel inside `bootstrap()` with per-fetcher fallback
- Publishing both a bulk `yourcloud.featureFlags` object and per-flag `yourcloud.features.<name>` keys
- Sharing a single HTTP client between `contribute()` and `bootstrap()` via a Map keyed on `clientId|domain`
- Registering an unref`ed periodic refresh timer that updates published feature flags without blocking process exit

## Related

- See `shared-http-client` for the full HTTP client with token caching and refresh dedupe
- See `runtime-context-keys` for key-naming conventions
- See `merge-strategies` for the full `optionsOverride` semantics
