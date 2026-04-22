---
name: merge-strategies
description: Per-field merge strategies for optionsOverride — override vs fillGaps vs additive, with worked examples.
tags: [cloud, merge, strategy, override, fillgaps, additive]
---

# `optionsOverride` Merge Strategies

Every entry in `CloudContributions.optionsOverride` carries its own `strategy`. Pick the one that matches the semantics of the field you're touching.

```typescript
interface CloudOptionOverride<TValue = unknown> {
  strategy: 'override' | 'fillGaps' | 'additive';
  value: TValue;
}
```

## Decision table

| You want                                             | Strategy   | Because                                                 |
| ---------------------------------------------------- | ---------- | ------------------------------------------------------- |
| Platform policy the user must not be able to relax   | `override` | Cloud value replaces user's entirely                    |
| A sensible default the user can still set themselves | `fillGaps` | Cloud value only applied when user didn't set the field |
| Extend a field the user is already using             | `additive` | Cloud and user values are combined                      |

## `override`

**Cloud wins unconditionally.** User's value at that field is discarded.

```typescript
optionsOverride: {
  rateLimits: {
    strategy: 'override',
    value: { maxRequestsPerMinute: 100 },
  },
}
```

**Use for:** platform-enforced rate limits, mandatory CORS allowlists when your platform controls them, audit-log destination URLs that must not drift.

**Avoid for:** anything the user should be able to tune. `override` silently masks their config — they set a value, it didn't take effect, they have no indication. Debugging is miserable.

## `fillGaps`

**User wins if set, cloud fills in when undefined.** This is the safest default strategy.

```typescript
optionsOverride: {
  cors: {
    strategy: 'fillGaps',
    value: { origin: ['https://managed.example'] },
  },
}

// User didn't set cors:   cors.origin = ['https://managed.example']
// User set cors.origin:   cors.origin = user's value — cloud ignored
```

**Use for:** default endpoint URLs, default timeouts, default feature toggles, any field where your platform knows a good value but the user is allowed to override.

**Avoid for:** fields where you discover the user has set `undefined` intentionally (e.g. "disable this feature"). `fillGaps` re-enables it.

## `additive`

**Arrays concat. Plain objects shallow-merge (user keys win on conflict). Scalars: user wins.**

```typescript
optionsOverride: {
  http: {
    strategy: 'additive',
    value: { defaultHeaders: { 'X-Platform': 'yourcloud' } },
  },
}

// User:   { http: { defaultHeaders: { 'X-Custom': '1' } } }
// Cloud:  { defaultHeaders: { 'X-Platform': 'yourcloud' } }
// After:  { defaultHeaders: { 'X-Custom': '1', 'X-Platform': 'yourcloud' } }
```

```typescript
optionsOverride: {
  allowedOrigins: {
    strategy: 'additive',
    value: ['https://cloud.example'],
  },
}

// User:   { allowedOrigins: ['https://user.example'] }
// After:  { allowedOrigins: ['https://user.example', 'https://cloud.example'] }
```

**Use for:** extending allowlists, adding default headers alongside user's, appending middleware layers.

**Avoid for:** fields where order matters (arrays append at the end). If you need to prepend, use `override` with `value: [...cloud, ...existing]` — but then you need access to the user's value, which the merger doesn't give you. In practice: accept append-only semantics or use `override` with a known user pattern.

## Worked example: CORS policy

```typescript
// ❌ Wrong: overriding the user's allowlist
optionsOverride: {
  cors: {
    strategy: 'override',
    value: { origin: ['https://cloud-managed.example'] },
  },
}
// User set origin: ['https://their-app.example'] — now their app breaks.

// ✅ Right for "platform-wide defaults"
optionsOverride: {
  cors: {
    strategy: 'fillGaps',
    value: { origin: ['https://cloud-managed.example'] },
  },
}
// User kept control.

// ✅ Right for "platform allowlist + user's own"
optionsOverride: {
  cors: {
    strategy: 'additive',
    value: { origin: ['https://cloud-managed.example'] },
  },
}
// Cloud's origin is appended to user's.
```

## Merge algorithm (what actually runs)

Conceptually:

```typescript
function applyOverride(userValue, cloudValue, strategy) {
  switch (strategy) {
    case 'override':
      return cloudValue;
    case 'fillGaps':
      return userValue === undefined ? cloudValue : userValue;
    case 'additive':
      if (userValue === undefined) return cloudValue;
      if (Array.isArray(userValue) && Array.isArray(cloudValue)) return [...userValue, ...cloudValue];
      if (isPlainObject(userValue) && isPlainObject(cloudValue)) {
        return { ...cloudValue, ...userValue }; // user keys win
      }
      return userValue;
  }
}
```

Unknown strategy: falls back to `fillGaps`.

## Anti-patterns

1. **`override` as a passive-aggressive default.** "If they didn't read the docs, they'll get my default." → Use `fillGaps` + explicit doc reference.
2. **`additive` on scalars.** Merger treats scalars as "user wins" — your cloud value is dropped. Use `fillGaps` instead.
3. **Deeply-nested objects under `additive`.** The merger shallow-merges. For deep merges, produce the deep-merged result yourself and pass it with `override` (only for fields you fully own).
4. **Mixing strategies across call sites.** If your `contribute()` runs twice (`bootstrap` and `createHandler`), ensure the returned strategy is stable. Changing it based on a lazy closure produces non-deterministic behavior.

## Validation

| Check                                    | Question                                                                |
| ---------------------------------------- | ----------------------------------------------------------------------- |
| Does this field have user-set semantics? | Yes → prefer `fillGaps` or `additive`                                   |
| Is this a platform-enforced policy?      | Yes → `override` is justified                                           |
| Does merging order matter?               | Append-only (`additive`) or predetermined (`override`) are your choices |

## Examples

| Example                                                                        | Level        | Description                                                                                                                                                                     |
| ------------------------------------------------------------------------------ | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`fillgaps-vs-override`](../examples/merge-strategies/fillgaps-vs-override.md) | Intermediate | Contrasts `fillGaps` and `override` strategies on the same `cors.origin` field, showing side-by-side what the user observes depending on whether they set the field themselves. |

## Reference

- Source: `libs/sdk/src/common/types/options/cloud/merge.ts`
- Tests: `libs/sdk/src/common/types/options/cloud/__tests__/merge.spec.ts` — each strategy has a unit test
