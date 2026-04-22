---
name: shared-http-client
description: Pattern for sharing a single HTTP client between contribute() (sync injection) and bootstrap() (async remote fetches) so you don't run two client_credentials grants at startup.
tags: [cloud, http, token-cache, client-credentials, bootstrap, contribute]
---

# Sharing an HTTP Client Across `contribute()` and `bootstrap()`

## The problem

A naive cloud provider constructs one HTTP client in `contribute()` (to register as a DI provider) and another in `bootstrap()` (to fetch tenant config). Two clients, two separate OAuth `client_credentials` token caches, two startup grants to your auth server — doubling rate-limit risk and slowing boot.

```typescript
// ❌ DO NOT DO THIS

contribute(options) {
  const http = new YourHttpClient(options);        // client #1
  return {
    providers: [{ provide: HttpToken, useValue: http }],
    /* ... */
  };
}

async bootstrap(ctx) {
  const http = new YourHttpClient(ctx.options);    // client #2 — DIFFERENT TOKEN CACHE
  await http.fetchTenantConfig();
}
```

Symptoms:

- `/oauth/token` sees two requests on cold start instead of one
- Concurrent token refreshes when a short TTL expires
- Rate-limit 429s from your auth server on large deployments

## The fix: construct once, key on a stable string

The SDK's merger (`mergeCloudContributions`) spreads user metadata into a
**new** object, so `ctx.options` inside `bootstrap()` is a DIFFERENT
reference than the one `contribute()` saw. A `WeakMap<object, Client>`
keyed on the options reference therefore misses on the second lookup and
both phases build their own client.

Use a `Map` keyed on a stable string that's unique per server instance —
`clientId|domain` works because the SDK forbids multiple cloud providers
for the same tenant:

```typescript
// src/your-cloud.provider.ts
import { YourHttpClient } from './http/client.js';

const clientCache = new Map<string, YourHttpClient>();

function cacheKey(options: Pick<CloudOptions, 'clientId' | 'domain'>): string {
  return `${options.clientId}|${options.domain ?? 'api.frontegg.com'}`;
}

function getOrCreateClient(options: CloudOptions): YourHttpClient {
  const key = cacheKey(options);
  let client = clientCache.get(key);
  if (!client) {
    client = new YourHttpClient(options);
    clientCache.set(key, client);
  }
  return client;
}

export const cloudProvider: CloudProvider = {
  name: 'yourcloud',
  contribute(options) {
    const http = getOrCreateClient(options);
    return {
      providers: [{ provide: HttpToken, useValue: http }],
      plugins: [YourCloudPlugin.init(options)],
    };
  },
  async bootstrap(ctx) {
    const http = getOrCreateClient(ctx.options); // SAME INSTANCE as contribute
    await http.fetchTenantConfig(ctx.runtime);
  },
};
```

**Why a string key, not the options object:** the options object passed
to `bootstrap()` comes from `mergeCloudContributions(parsedConfig, ...)`
which returns a NEW object — the reference differs from the one
`contribute()` saw. A WeakMap keyed on the object would miss.

**Why `clientId|domain`:** uniquely identifies a tenant + environment.
Two plugin instances for the same tenant (rare but possible in tests)
correctly share a client; distinct tenants get isolated clients.

**Clean-up for tests:** export a `clearCache()` helper that empties the
map between test runs if you construct multiple instances in-process.

## Alternative: thread via runtime context

If your `contribute()` registers a DI provider and your `bootstrap()` can read the runtime context, you can also flow the client through there:

```typescript
contribute(options) {
  const http = new YourHttpClient(options);
  return {
    plugins: [YourCloudPlugin.init({ http })],
    // expose via runtime so bootstrap() can retrieve it
    providers: [{ provide: HttpToken, useValue: http }],
  };
}

async bootstrap(ctx) {
  // Convention: your plugin's init() also sets it on runtime
  const http = ctx.runtime.get<YourHttpClient>('yourcloud.http');
  if (!http) {
    ctx.logger.error('yourcloud: http client not initialized');
    return;
  }
  await http.fetchTenantConfig(ctx.runtime);
}
```

Downside: requires your plugin to remember to `runtime.set('yourcloud.http', this.http)` during its own init. Subtle ordering dependency. Prefer the WeakMap pattern for robustness.

## Token refresh invariants

Your shared HTTP client owns the token cache. Make sure it:

1. **Caches until early-refresh skew** — refresh at `expiresAt - 30s` so concurrent requests don't race a stale token.
2. **Dedupes concurrent refreshes** — in-flight `Promise<Token>` stored on the instance; concurrent callers await the same promise.
3. **Invalidates on 401** — a single one-shot retry after token refresh covers the "server rotated keys" case.
4. **Doesn't infinite-loop on 401** — after one refresh-retry, bubble the 401 to the caller.

```typescript
export class YourHttpClient {
  private cachedToken?: { accessToken: string; expiresAt: number };
  private inFlightRefresh?: Promise<{ accessToken: string; expiresAt: number }>;

  async getToken(): Promise<string> {
    const now = Date.now();
    if (this.cachedToken && this.cachedToken.expiresAt - 30_000 > now) {
      return this.cachedToken.accessToken;
    }
    if (!this.inFlightRefresh) {
      this.inFlightRefresh = this.refreshToken().finally(() => {
        this.inFlightRefresh = undefined;
      });
    }
    const token = await this.inFlightRefresh;
    this.cachedToken = token;
    return token.accessToken;
  }

  private async refreshToken() {
    const response = await fetch(`${this.baseUrl}/oauth/token`, {
      method: 'POST',
      headers: { Authorization: `Basic ${this.basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials' }).toString(),
    });
    if (!response.ok) throw new Error(`token fetch failed: ${response.status}`);
    const data = await response.json();
    return { accessToken: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 };
  }
}
```

## Race condition to watch

If the refreshed token is itself within the skew window (very short `expires_in`), every subsequent call will re-trigger the refresh. Defend:

```typescript
const token = await this.inFlightRefresh;
if (token.expiresAt - 30_000 <= Date.now()) {
  this.cachedToken = undefined;
  throw new Error('auth server returned already-expiring token');
}
this.cachedToken = token;
```

## Multi-tenant caveat

If your cloud handles per-tenant tokens (end-user JWTs), the shared-client pattern applies per tenant. Key the WeakMap or Map by `(options, tenantId)` if tokens aren't client-credentials.

## Reference

- Frontegg reference implementation: `libs/plugin-frontegg/src/http/frontegg-http.client.ts`
  - See `getVendorToken()` + `inFlightTokenRefresh` for the dedupe pattern
