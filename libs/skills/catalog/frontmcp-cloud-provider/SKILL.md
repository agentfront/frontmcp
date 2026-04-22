---
name: frontmcp-cloud-provider
description: 'Build your own cloud provider — a packaged integration that a FrontMCP server loads with a single `cloud: { ... }` config line and that contributes plugins, adapters, providers, tools, resources, option overrides, and fetches tenant-managed runtime config over the network. Use when you want to ship an opinionated all-in-one integration (like the Frontegg provider) for your own platform, internal PaaS, or enterprise identity/control plane.'
tags:
  [
    cloud,
    provider,
    enterprise,
    platform,
    extensibility,
    sdk,
    contribute,
    bootstrap,
    runtime-context,
    plugin-composition,
  ]
category: extensibility
targets: [all]
bundle: [full]
priority: 9
visibility: both
license: Apache-2.0
metadata:
  docs: https://docs.agentfront.dev/frontmcp/extensibility/cloud-providers
---

# FrontMCP Cloud Provider

A **cloud provider** is a single npm package a customer installs that, with one `cloud: { ... }` line on `@FrontMcp()`, wires up an entire opinionated integration — auth, tool proxy, approvals, policy enforcement, audit logging, tenant-managed runtime config — without the customer ever importing the package directly. The SDK auto-loads it at bootstrap, calls a synchronous `contribute()` hook to merge static contributions (plugins, adapters, providers, option overrides) into server metadata, then runs an async `bootstrap()` hook after the scope is ready to fetch remote config and populate a shared runtime context.

This is the extension point the Frontegg integration is built on (`@frontmcp/plugin-frontegg`). This skill shows how to build your own.

> **When this matters:** a "plugin" extends runtime behavior. A "cloud provider" bundles plugins + adapters + option overrides + remote runtime config into a single coherent integration surface. If you're shipping an enterprise integration that a customer should be able to opt into with just credentials, you want a cloud provider.

## When to Use This Skill

### Must Use

- Packaging an enterprise identity/control-plane integration (IAM, policy engine, audit pipeline) as a single drop-in npm module
- Building the "Bring Your Own Cloud" surface for a PaaS so customers get auth + proxying + approvals + observability with one config object
- Shipping an integration that needs to fetch tenant-managed runtime config (feature flags, CORS allowlists, endpoint overrides, login URLs) over the network at bootstrap

### Recommended

- Replacing a tangle of `plugins: [...]` + `providers: [...]` + `adapters: [...]` entries in your customer's `@FrontMcp()` config with a single `cloud: { ... }` line
- Injecting option overrides (CORS origins, feature flags) that the platform manages and the customer should not hand-maintain
- Publishing an integration that must stay optional — installed separately, lazy-loaded by the SDK, and absent-safe

### Skip When

- You only need a single plugin with hooks and context extensions — use `create-plugin-hooks` in `frontmcp-development`
- You only need to integrate one external library — use `frontmcp-extensibility`
- You're authoring an adapter for a specific source (OpenAPI, GraphQL) — use `create-adapter` in `frontmcp-development`

> **Decision:** Use this skill when you want a single installable package that delivers a whole integration surface, auto-wired by `cloud: { ... }`. Use `frontmcp-development` or `frontmcp-extensibility` for narrower extensions.

## Mental Model

The SDK owns four moving parts. Your package fills them in.

| SDK primitive                         | Owner                 | Your cloud provider's job                                                                                            |
| ------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `CloudOptions` interface + Zod schema | SDK (`@frontmcp/sdk`) | Consume — the user's `cloud: { ... }` values arrive typed and validated                                              |
| `CloudProvider` contract              | SDK                   | Implement — export `cloudProvider` with `name`, `contribute`, optional `bootstrap`                                   |
| `CloudContributions` + merger         | SDK                   | Produce — return plugins, adapters, providers, tools, resources, and per-field `optionsOverride` from `contribute()` |
| `CloudRuntimeContext` (DI token)      | SDK                   | Populate — set values in `bootstrap()`; consumers `runtime.get('your.feature')` via DI                               |

### Lifecycle at a glance

```
┌─ user calls @FrontMcp({ cloud: {...} })
│
├─ SDK parses CloudOptions with Zod (applies defaults: domain, flags, batch sizes)
│
├─ FrontMcpInstance.applyCloudContributions():
│    - lazy require('@your-org/plugin-yourcloud')
│    - your cloudProvider.contribute(cloudOpts) runs SYNCHRONOUSLY
│    - SDK merges your CloudContributions into metadata (additive arrays, strategy-driven overrides)
│
├─ new FrontMcpInstance(merged) → initialize() → scope ready
│
└─ SDK calls cloudProvider.bootstrap({ options, runtime, logger }) ASYNCHRONOUSLY
     - you fetch tenant config over HTTP, populate runtime context
     - errors log-and-continue (never abort startup)
```

Everything you contribute in `contribute()` must be **pure + synchronous + static** — no `await`, no `fetch`. Remote work happens in `bootstrap()`.

## Prerequisites

- Running `@frontmcp/sdk` ≥ the version that exposes `CloudOptions` and `CloudProvider` types
- A separate npm package for your integration (do NOT put it inside the consumer's repo — the SDK lazy-requires it by name)
- Authentication endpoint on your backend if you plan to contact it from `bootstrap()`

## Steps

### Step 1: Scaffold the package

> **⚠ Package name is hard-coded in the SDK resolver today.**
> `libs/sdk/src/scope/cloud-autoload.ts` contains a `KNOWN_PROVIDERS` map that
> currently resolves only `@frontmcp/plugin-frontegg`. To ship a third-party
> cloud provider you must either (a) open a PR upstream adding your package
> name, or (b) fork the SDK's resolver. A future SDK release is expected to
> expose a user-registerable resolver; until then this is the supported path.

Mirror the published Frontegg package layout. Your package must export a value named `cloudProvider` from its main entry.

```
my-cloud/
  src/
    index.ts                      # exports cloudProvider + public types
    your-cloud.provider.ts        # implements CloudProvider contract
    your-cloud.plugin.ts          # optional: internal DynamicPlugin composed via contribute()
    runtime.ts                    # types + helpers for runtime context keys
    http/your-cloud.client.ts     # HTTP client (reuse the SDK's retry patterns)
  package.json                    # peerDependencies: { "@frontmcp/sdk": ">=x.y.z" }
```

Key `package.json` bits:

```json
{
  "name": "@your-org/plugin-yourcloud",
  "publishConfig": { "access": "public" },
  "peerDependencies": { "@frontmcp/sdk": ">=1.2.0" }
}
```

The SDK looks up the package by hard-coded name in `scope/cloud-autoload.ts`. Until there's a provider registry, pick the exact name the SDK expects or submit a PR to add your resolver.

### Step 2: Implement `CloudProvider.contribute()`

This is your **static injection point**. Runs synchronously at metadata-parse time. Return a `CloudContributions` object describing what you want merged into the server config.

```typescript
// src/your-cloud.provider.ts
import type { CloudContributions, CloudOptions, CloudProvider } from '@frontmcp/sdk';

import YourCloudPlugin from './your-cloud.plugin';

export const cloudProvider: CloudProvider = {
  name: 'yourcloud',

  contribute(options: CloudOptions): CloudContributions {
    return {
      // Arrays: additive. Your plugin joins the user's existing `plugins: [...]`.
      plugins: [YourCloudPlugin.init(options)],

      // Option overrides: per-field strategy.
      optionsOverride: {
        cors: {
          strategy: 'fillGaps', // user's explicit cors wins
          value: { origin: [] }, // populated by bootstrap() later
        },
        http: {
          strategy: 'additive', // merge objects; user keys override
          value: { requestTimeout: 30_000 },
        },
      },
    };
  },
};
```

**Contract:** `contribute()` is called before ANY async work. Side effects forbidden. Throw only on invalid options (SDK catches and logs).

### Step 3: Implement `CloudProvider.bootstrap()` (optional, but this is where the enterprise magic happens)

This runs **after** the scope is initialized. You get:

- `options`: the resolved `CloudOptions` (defaults applied)
- `runtime`: the shared `CloudRuntimeContext` — `get`/`set`/`isEnabled`/`merge`/`snapshot`
- `logger`: scoped to `cloud:<your-name>`

```typescript
// src/your-cloud.provider.ts (continued)
export const cloudProvider: CloudProvider = {
  name: 'yourcloud',
  contribute(options) {
    /* ... */
  },

  async bootstrap(ctx) {
    const client = new YourCloudClient(ctx.options);

    // Fetch tenant-managed config in parallel. Tolerate per-fetcher failures:
    // one 404 shouldn't block the whole bootstrap.
    const [flags, allowlist, loginUrl] = await Promise.all([
      client.getFeatureFlags().catch((e) => {
        ctx.logger.warn('yourcloud: feature-flag fetch failed', { error: String(e) });
        return {};
      }),
      client.getCorsAllowlist().catch(() => []),
      client.getLoginUrl().catch(() => undefined),
    ]);

    // Publish into the shared runtime context under well-known keys so host
    // tools / hooks / adapters can read them via DI.
    ctx.runtime.set('yourcloud.featureFlags', flags);
    ctx.runtime.set('yourcloud.corsOrigins', allowlist);
    ctx.runtime.set('yourcloud.loginUrl', loginUrl);

    // For boolean feature flags, also expose them at top-level so
    // `runtime.isEnabled('yourcloud.features.newCheckout')` works ergonomically.
    for (const [name, enabled] of Object.entries(flags)) {
      ctx.runtime.set(`yourcloud.features.${name}`, Boolean(enabled));
    }

    ctx.logger.info('yourcloud: bootstrap complete', {
      flags: Object.keys(flags).length,
      origins: allowlist.length,
    });
  },
};
```

**Contract:** `bootstrap()` is non-blocking with respect to server startup — the SDK catches and logs errors, then continues. Your server still comes up. If you need hard-fail semantics, throw _before_ the SDK calls you (i.e., validate in `contribute()`).

### Step 4: Compose internal plugins, adapters, and providers

`contribute()` can inject anything a user's `@FrontMcp()` accepts. The SDK's merger (`mergeCloudContributions`) concatenates arrays additively and applies `optionsOverride` per declared strategy.

```typescript
contribute(options: CloudOptions): CloudContributions {
  return {
    plugins: [
      AuthPlugin.init({ jwksUrl: `https://${options.domain}/.well-known/jwks.json` }),
      AuditPlugin.init({ endpoint: options.telemetry?.endpoint }),
    ],
    adapters: [
      // inject transport adapters, middleware, etc.
    ],
    providers: [
      { provide: YourCloudConfigToken, useValue: options },
    ],
    tools: [/* pre-built tools your platform ships */],
    resources: [/* platform resources */],
    skills: [/* curated skill metadata */],
    optionsOverride: {
      cors: { strategy: 'fillGaps', value: { origin: [] } },
    },
  };
}
```

See `references/contribute-api.md` for the full `CloudContributions` shape and every supported merge strategy.

### Step 5: Read cloud-published values from host tools

The SDK registers `CloudRuntimeContext` as a global provider. Any tool, hook, or adapter can inject the token and read what your `bootstrap()` published.

```typescript
import { CloudRuntimeContextToken, Tool, ToolContext, type CloudRuntimeContext } from '@frontmcp/sdk';

@Tool({ name: 'do-checkout' })
class CheckoutTool extends ToolContext {
  async execute(input: Input): Promise<Output> {
    // Inject via this.get() inside the body — the @Tool decorator has no
    // `providers` field; DI resolution happens at execute() time.
    const runtime = this.get<CloudRuntimeContext>(CloudRuntimeContextToken);
    if (!runtime.isEnabled('yourcloud.features.newCheckout')) {
      throw new FeatureDisabledError('new-checkout is disabled for this tenant');
    }
    // ...
  }
}
```

This is how enterprise toggles land in your customer's code without them writing any feature-flag glue.

### Step 6: Handle absent / misconfigured installations gracefully

The SDK wraps your `require(...)` in try/catch. If your package isn't installed, the SDK logs a warning and starts without cloud features. You do NOT need to defend against that.

What you DO need to handle:

- **Invalid options** — throw from `contribute()` so the SDK surfaces the error before startup.
- **Remote config unreachable** — catch inside `bootstrap()`, populate sensible runtime defaults, log a warning. Don't let one failed fetch abort your whole bootstrap.
- **Token refresh cycles** — if your HTTP client uses `client_credentials`, cache the token with early-refresh (30s skew) and dedupe concurrent refreshes with an `inFlightTokenRefresh` promise.

## Common Patterns

| Pattern                  | Correct                                                                               | Incorrect                                         | Why                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `contribute()` body      | Synchronous, pure, static returns                                                     | `async contribute()` or `await` inside            | SDK calls it before the scope exists; async work belongs in `bootstrap()`               |
| Feature-flag publish     | `runtime.set('yourcloud.features.X', true)` + bulk object at `yourcloud.featureFlags` | Only bulk object                                  | Consumers want both `isEnabled` and `get(bulk)` access                                  |
| Option override strategy | `{ strategy: 'fillGaps', value: {...} }` for user-overridable defaults                | `{ strategy: 'override' }` for user-facing config | `override` silently masks the user's own settings — reserved for policy-enforced fields |
| Bootstrap error handling | `await fetch(...).catch((e) => { logger.warn(...); return default; })`                | Let the error propagate                           | SDK catches + logs but your server loses ALL cloud features; prefer partial degradation |
| Package name resolution  | Hard-coded in SDK resolver                                                            | Dynamic / configurable                            | Until there's a provider registry, the SDK knows exactly one name per cloud             |

## Scenario Routing Table

| Scenario                                        | Reference                            | Description                                                                                                   |
| ----------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| Author `cloudProvider.contribute()`             | `references/contribute-api.md`       | Full `CloudContributions` shape, merge strategies, what's safe to inject                                      |
| Populate runtime context from remote config     | `references/bootstrap-api.md`        | `bootstrap()` signature, runtime context keys, error-handling patterns                                        |
| Choose per-field merge strategy                 | `references/merge-strategies.md`     | `override` vs `fillGaps` vs `additive` — when each applies                                                    |
| Package for npm + publish                       | `references/packaging.md`            | `peerDependencies`, lazy-load safety, CJS/ESM considerations                                                  |
| Thread a shared HTTP client into both phases    | `references/shared-http-client.md`   | Pattern for avoiding duplicate token caches between `contribute`-time providers and `bootstrap`-time fetchers |
| Publish feature flags consumers can read via DI | `references/runtime-context-keys.md` | Key-naming conventions, `isEnabled` vs `get` patterns                                                         |

## Verification Checklist

### Package surface

- [ ] `index.ts` exports `cloudProvider` (named export — the SDK looks for this exact name)
- [ ] `cloudProvider.name` is set to a stable identifier (`'frontegg'`, `'yourcloud'`, …)
- [ ] `cloudProvider.contribute` is a sync function returning `CloudContributions | undefined`
- [ ] `cloudProvider.bootstrap` (if present) is async and never throws out of `try/catch` blocks wrapping remote calls
- [ ] `package.json` declares `@frontmcp/sdk` as a `peerDependency`, NOT a regular `dependency`

### Static contributions

- [ ] Every `optionsOverride` entry has a declared `strategy`
- [ ] No `async` / `await` inside `contribute()`
- [ ] Plugin / provider injections match the SDK's expected types

### Runtime behavior

- [ ] Absent package: customer installs nothing, SDK logs `cloud config is set but the cloud provider package is not installed` and starts normally
- [ ] Invalid options: customer gets a clear error from your schema/validation in `contribute()`
- [ ] Network failure in `bootstrap()`: server still starts; runtime context has sensible defaults; warning logged
- [ ] Host tools inject `CloudRuntimeContextToken` and successfully read values your `bootstrap()` published

### Security

- [ ] Secrets (client secret, API keys) are NOT included in any emitted event or logged at info level
- [ ] Your `optionsOverride` NEVER injects a value at `override` strategy unless it's policy-enforced (CORS allowlist, rate limits)
- [ ] `CloudOptions` shape is validated before you trust any field (don't assume the SDK's Zod caught everything — you ran after the merge)

## Troubleshooting

| Problem                                                                                           | Cause                                                                                                               | Solution                                                                                                                                               |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `cloud config is set but the cloud provider package is not installed`                             | Customer's package.json doesn't depend on your package, or your package's name doesn't match what the SDK resolves  | Document the exact `npm install @your-org/plugin-yourcloud` line; verify the SDK version supports your package name                                    |
| Host tools can't read runtime context values                                                      | Your `bootstrap()` threw before `runtime.set(...)` ran, OR the consumer disabled the cloud runtime context provider | Inspect server logs for `cloud: provider '<name>' bootstrap failed`; wrap every `runtime.set` after a `.catch` default                                 |
| User's `cors.origin` gets silently replaced                                                       | You used `strategy: 'override'` for `cors`                                                                          | Switch to `fillGaps` unless the CORS allowlist is policy-enforced by your platform                                                                     |
| Duplicate `client_credentials` grants at startup                                                  | `contribute()` creates one HTTP client, `bootstrap()` creates another — each with its own token cache               | Build the HTTP client once, thread it via `providers` in `contribute()` and via `runtime.get` in `bootstrap()`; see `references/shared-http-client.md` |
| `typeof cloudProvider.bootstrap === 'function'` passes but it's actually undefined in some builds | ESM/CJS interop — default import vs named                                                                           | Always export `cloudProvider` as a NAMED export from your main entry; avoid `export default`                                                           |

## Reference

Full API details and copy-pasteable patterns in `references/`:

- [`contribute-api.md`](references/contribute-api.md) — `CloudContributions` shape, array vs object merging, forbidden patterns
- [`bootstrap-api.md`](references/bootstrap-api.md) — `CloudBootstrapContext`, runtime-context idioms, error strategies
- [`merge-strategies.md`](references/merge-strategies.md) — `override` vs `fillGaps` vs `additive` with worked examples
- [`packaging.md`](references/packaging.md) — peer dep rules, ESM/CJS, SDK version compatibility
- [`shared-http-client.md`](references/shared-http-client.md) — avoiding double-token-caches across phases
- [`runtime-context-keys.md`](references/runtime-context-keys.md) — key-naming conventions, feature flag publishing

## Examples

Each reference has a corresponding `examples/<reference-name>/` directory with copy-pasteable provider code.

| Example                                                                     | Level        | Description                                                                                                        |
| --------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------ |
| [`minimal-provider`](examples/contribute-api/minimal-provider.md)           | Basic        | Smallest possible CloudProvider: name + `contribute()` returning a single plugin                                   |
| [`full-lifecycle`](examples/bootstrap-api/full-lifecycle.md)                | Advanced     | Contribute plugins + providers + option overrides, then fetch tenant config in bootstrap and publish feature flags |
| [`fillgaps-vs-override`](examples/merge-strategies/fillgaps-vs-override.md) | Intermediate | Side-by-side showing when each strategy changes user-observable behavior                                           |

> See all examples in [`examples/`](examples/)

## Related skills

- `frontmcp-extensibility` — integrate single external libraries (vs. a whole cloud)
- `frontmcp-development` — author plugins, adapters, flows (what your `contribute()` returns)
- `frontmcp-config` — what `@FrontMcp({ cloud: { ... } })` lives alongside
- `frontmcp-production-readiness` — retries, telemetry, health probes for your cloud's runtime behavior
