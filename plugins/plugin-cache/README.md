# @frontmcp/plugin-cache

Cache plugin for FrontMCP - provides automatic tool result caching with support for Redis, Vercel KV, and in-memory storage.

## Installation

```bash
npm install @frontmcp/plugin-cache
```

## Usage

```typescript
import { CachePlugin } from '@frontmcp/plugin-cache';
import { App } from '@frontmcp/sdk';

@App({
  plugins: [CachePlugin],
})
class MyApp {}
```

## Features

- **Multiple storage backends**: Redis, Vercel KV, or in-memory
- **Automatic TTL management**: Configure cache expiration
- **Tool result caching**: Automatically cache tool execution results
- **Configurable cache keys**: Customize how cache keys are generated

## Configuration

### In-Memory (Default)

```typescript
import { CachePlugin } from '@frontmcp/plugin-cache';

@App({
  plugins: [
    CachePlugin.init({
      type: 'memory',
      defaultTTL: 300, // TTL in seconds (default: 1 day)
    }),
  ],
})
class MyApp {}
```

### Redis

```typescript
import { CachePlugin } from '@frontmcp/plugin-cache';

@App({
  plugins: [
    CachePlugin.init({
      type: 'redis',
      defaultTTL: 300,
      config: {
        host: 'localhost',
        port: 6379,
        password: process.env.REDIS_PASSWORD, // optional
        db: 0, // optional
      },
    }),
  ],
})
class MyApp {}
```

### Redis Client (Reuse Existing)

```typescript
import { CachePlugin } from '@frontmcp/plugin-cache';
import { Redis } from 'ioredis';

const redis = new Redis({ host: 'localhost', port: 6379 });

@App({
  plugins: [
    CachePlugin.init({
      type: 'redis-client',
      client: redis,
      defaultTTL: 300,
    }),
  ],
})
class MyApp {}
```

### Global Store

Use the store configuration from `@FrontMcp` decorator:

```typescript
import { CachePlugin } from '@frontmcp/plugin-cache';

@App({
  plugins: [
    CachePlugin.init({
      type: 'global-store', // Uses redis/vercel-kv from FrontMcp config
    }),
  ],
})
class MyApp {}
```

## License

Apache-2.0
