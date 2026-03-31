---
name: minimal-guard-config
reference: configure-throttle-guard-config
level: basic
description: 'Enable throttle with just a global rate limit and default timeout.'
tags: [config, throttle, guard, minimal]
features:
  - 'The minimum fields needed to enable the guard: `enabled`, `global`, and `defaultTimeout`'
  - "`partitionBy: 'global'` shares one counter across all clients"
  - '`windowMs` defaults to 60000 (1 minute) if omitted'
  - 'Other fields (`globalConcurrency`, `ipFilter`, `storage`) are optional'
---

# Minimal GuardConfig

Enable throttle with just a global rate limit and default timeout.

## Code

```typescript
// src/server.ts
import { FrontMcp, App } from '@frontmcp/sdk';

@App({ name: 'my-app' })
class MyApp {}

@FrontMcp({
  info: { name: 'guarded-server', version: '1.0.0' },
  apps: [MyApp],
  throttle: {
    enabled: true,
    global: {
      maxRequests: 1000,
      windowMs: 60000,
      partitionBy: 'global',
    },
    defaultTimeout: {
      executeMs: 30000,
    },
  },
})
class Server {}
```

## What This Demonstrates

- The minimum fields needed to enable the guard: `enabled`, `global`, and `defaultTimeout`
- `partitionBy: 'global'` shares one counter across all clients
- `windowMs` defaults to 60000 (1 minute) if omitted
- Other fields (`globalConcurrency`, `ipFilter`, `storage`) are optional

## Related

- See `configure-throttle-guard-config` for the complete GuardConfig interface
- See `configure-throttle` for practical throttle configuration patterns
