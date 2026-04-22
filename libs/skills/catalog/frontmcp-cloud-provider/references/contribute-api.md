---
name: contribute-api
description: The synchronous injection hook every CloudProvider exposes. Returns CloudContributions describing what to merge into server metadata.
tags: [cloud, contribute, contributions, merge, plugins, providers, adapters]
---

# `cloudProvider.contribute(options)`

## Signature

```typescript
interface CloudProvider {
  name: string;
  contribute(options: CloudOptions): CloudContributions | undefined;
  bootstrap?(ctx: CloudBootstrapContext): Promise<void>;
}
```

Called **synchronously** by the SDK during `FrontMcpInstance.applyCloudContributions()`, before the scope is constructed. Anything you return is merged into the `@FrontMcp()` metadata, Zod-validated, and handed to the Scope.

## `CloudContributions` shape

```typescript
interface CloudContributions {
  plugins?: PluginType[]; // appended additively
  adapters?: unknown[]; // appended additively
  providers?: ProviderType[]; // appended additively
  tools?: ToolType[]; // appended additively
  resources?: ResourceType[]; // appended additively
  skills?: SkillType[]; // appended additively
  apps?: AppType[]; // appended additively
  optionsOverride?: Record<string, CloudOptionOverride>; // per-field strategy
}

interface CloudOptionOverride<TValue = unknown> {
  strategy: 'additive' | 'override' | 'fillGaps';
  value: TValue;
}
```

Every field is optional. Returning `undefined` is equivalent to returning `{}`.

## Contract

| Property    | Rule                                                                                                                           |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Purity      | No side effects. No global mutation. No `console.log` leaks.                                                                   |
| Async       | **Forbidden.** No `await`, no `fetch`, no `import()`. Use `bootstrap()` for I/O.                                               |
| Throwing    | Allowed for invalid options — the SDK catches, logs, and continues without your contributions. The server still starts.        |
| Determinism | Same options → same contributions. The SDK may call `contribute` multiple times (e.g. `createHandler` + `bootstrap` in tests). |

## Additive arrays

All array fields are appended to whatever the user declared in `@FrontMcp({ ... })`. Your plugin does NOT replace the user's — it joins them.

```typescript
// User:
@FrontMcp({ plugins: [LoggingPlugin.init()], cloud: { clientId, secret } })

// Your contribute():
return { plugins: [AuthPlugin.init(options), AuditPlugin.init(options)] };

// After merge:
// plugins: [LoggingPlugin.init(), AuthPlugin.init(...), AuditPlugin.init(...)]
```

Order: user entries come first, cloud entries appended. Useful when plugin order matters (auth should run before business logic, but the user's plugins usually already assume that).

## `optionsOverride` merge strategies

| Strategy   | Semantic                                                               | Typical use                                                                                     |
| ---------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `override` | Cloud value replaces user value entirely                               | Policy-enforced fields (CORS allowlists mandated by the platform, rate-limits)                  |
| `fillGaps` | Cloud value used ONLY when user field is undefined                     | Sensible defaults the user can still override                                                   |
| `additive` | Arrays concat; plain objects shallow-merge (user keys win on conflict) | Extending a field the user already partially set (e.g. adding headers to `http.defaultHeaders`) |

Unknown strategy falls back to `fillGaps` (safest).

### Worked example: CORS

```typescript
// Your contribute():
return {
  optionsOverride: {
    cors: {
      strategy: 'fillGaps',
      value: { origin: ['https://managed.example'] },
    },
  },
};

// Case A: user sets cors.origin
// User:  { cors: { origin: ['https://user.example'] } }
// After: { cors: { origin: ['https://user.example'] } }   ← user wins

// Case B: user didn't set cors
// User:  {}
// After: { cors: { origin: ['https://managed.example'] } }  ← cloud fills the gap
```

Same example with `strategy: 'override'`:

```typescript
// Case A: user set cors.origin — gets silently replaced
// After: { cors: { origin: ['https://managed.example'] } }  ← user's value lost
```

> **Warning:** `override` is a big stick. Only use it for fields your platform must enforce — never for "I think this is a better default."

## Forbidden patterns

```typescript
// ❌ async contribute — SDK expects sync, will not await
async contribute(options) {
  const flags = await fetch(...).then(r => r.json());
  return { /* ... */ };
}

// ❌ side effects — contribute runs during metadata parse
contribute(options) {
  global.YOURCLOUD_READY = true;       // don't
  this.cachedOptions = options;         // don't — your instance is the singleton cloudProvider
  return { /* ... */ };
}

// ❌ returning a plugin constructed with non-deterministic data
contribute(options) {
  return {
    plugins: [Plugin.init({ requestId: randomUUID() })],  // different each call
  };
}

// ❌ using override to inject defaults the user is allowed to customize
optionsOverride: {
  http: { strategy: 'override', value: { timeout: 30_000 } },   // silently masks user's 60_000
}
```

## Safe patterns

```typescript
// ✅ Deterministic, sync, pure
contribute(options: CloudOptions): CloudContributions {
  const resolved = resolveDefaults(options);
  return {
    plugins: [YourCloudPlugin.init(resolved)],
    providers: [{ provide: YourCloudConfigToken, useValue: resolved }],
    optionsOverride: {
      cors: { strategy: 'fillGaps', value: { origin: [] } },   // filled later in bootstrap
    },
  };
}

// ✅ Throwing for invalid input — surfaces the error at config-parse time
contribute(options) {
  if (!options.clientId) throw new Error('[yourcloud] clientId is required');
  return { /* ... */ };
}
```

## Reading the merged config after the fact

If you need to react to the final merged config (e.g. which plugins the user declared), do it in `bootstrap()` — `ctx.options` there is the resolved `CloudOptions` but the full merged metadata is not directly exposed. Prefer publishing into `runtime` from `bootstrap` and having your plugin read from the runtime context at request time.

## Examples

| Example                                                              | Level | Description                                                                                                                                                                       |
| -------------------------------------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`minimal-provider`](../examples/contribute-api/minimal-provider.md) | Basic | Shows the smallest possible CloudProvider — a named export with `name` and a sync `contribute()` that returns a single plugin, plus the matching package.json for npm publishing. |

## Reference

- `CloudProvider`, `CloudContributions`, `CloudOptionOverride` — exported from `@frontmcp/sdk`
- Source: `libs/sdk/src/common/types/options/cloud/provider.ts`
- Merger: `libs/sdk/src/common/types/options/cloud/merge.ts`
