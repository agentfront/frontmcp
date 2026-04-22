---
name: fillgaps-vs-override
reference: merge-strategies
level: intermediate
description: 'Contrasts `fillGaps` and `override` strategies on the same `cors.origin` field, showing side-by-side what the user observes depending on whether they set the field themselves.'
tags: [cloud, merge, cors, strategy, fillgaps, override]
features:
  - "Applying `strategy: fillGaps` so the user's `cors.origin` wins when they set it and the cloud value fills in only when it is undefined"
  - "Applying `strategy: override` so the cloud's `cors.origin` replaces whatever the user set"
  - 'Comparing `strategy: additive` as a third option that concatenates user and cloud arrays'
  - 'Choosing `fillGaps` as the safe default for user-tunable fields'
  - 'Reserving `override` for platform-enforced policies such as a mandatory CORS allowlist'
---

# `fillGaps` vs `override` — Side by Side

Contrasts `fillGaps` and `override` strategies on the same `cors.origin` field, showing side-by-side what the user observes depending on whether they set the field themselves.

## Variant A — `fillGaps`

```typescript
import type { CloudContributions, CloudOptions, CloudProvider } from '@frontmcp/sdk';

const CLOUD_ORIGINS = ['https://cloud-managed.example'];

export const cloudProvider: CloudProvider = {
  name: 'yourcloud',
  contribute(options: CloudOptions): CloudContributions {
    return {
      optionsOverride: {
        cors: {
          strategy: 'fillGaps',
          value: { origin: CLOUD_ORIGINS },
        },
      },
    };
  },
};
```

| User's config                                | Resulting `cors.origin`             |
| -------------------------------------------- | ----------------------------------- |
| `cors: undefined`                            | `['https://cloud-managed.example']` |
| `cors: { origin: ['https://user.example'] }` | `['https://user.example']`          |
| `cors: { origin: [] }`                       | `[]`                                |

## Variant B — `override`

```typescript
export const cloudProvider: CloudProvider = {
  name: 'yourcloud',
  contribute(options: CloudOptions): CloudContributions {
    return {
      optionsOverride: {
        cors: {
          strategy: 'override',
          value: { origin: CLOUD_ORIGINS },
        },
      },
    };
  },
};
```

| User's config                                | Resulting `cors.origin`             |
| -------------------------------------------- | ----------------------------------- |
| `cors: undefined`                            | `['https://cloud-managed.example']` |
| `cors: { origin: ['https://user.example'] }` | `['https://cloud-managed.example']` |
| `cors: { origin: [] }`                       | `['https://cloud-managed.example']` |

## Variant C — `additive`

```typescript
optionsOverride: {
  cors: {
    strategy: 'additive',
    value: { origin: CLOUD_ORIGINS },
  },
},
```

| User's config                                | Resulting `cors.origin`                                     |
| -------------------------------------------- | ----------------------------------------------------------- |
| `cors: undefined`                            | `['https://cloud-managed.example']`                         |
| `cors: { origin: ['https://user.example'] }` | `['https://user.example', 'https://cloud-managed.example']` |
| `cors: { origin: [] }`                       | `['https://cloud-managed.example']`                         |

## What This Demonstrates

- Applying `strategy: fillGaps` so the user's `cors.origin` wins when they set it and the cloud value fills in only when it is undefined
- Applying `strategy: override` so the cloud's `cors.origin` replaces whatever the user set
- Comparing `strategy: additive` as a third option that concatenates user and cloud arrays
- Choosing `fillGaps` as the safe default for user-tunable fields
- Reserving `override` for platform-enforced policies such as a mandatory CORS allowlist

## Related

- See `merge-strategies` for the full decision matrix and the merger's exact algorithm
- See `contribute-api` for the full `CloudContributions` shape
