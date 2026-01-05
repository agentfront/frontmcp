# @frontmcp/plugin-cache

Cache plugin for FrontMCP - provides automatic tool result caching with support for Redis, Vercel KV, and in-memory storage.

## Installation

```bash
npm install @frontmcp/plugin-cache
```

## Usage

```typescript
import { CachePlugin } from '@frontmcp/plugin-cache';
import { FrontMcp } from '@frontmcp/sdk';

const app = new FrontMcp({
  plugins: [CachePlugin],
});
```

## Features

- **Multiple storage backends**: Redis, Vercel KV, or in-memory
- **Automatic TTL management**: Configure cache expiration
- **Tool result caching**: Automatically cache tool execution results
- **Configurable cache keys**: Customize how cache keys are generated

## Configuration

```typescript
import { CachePlugin } from '@frontmcp/plugin-cache';

const app = new FrontMcp({
  plugins: [
    CachePlugin.configure({
      store: 'redis', // 'redis' | 'vercel-kv' | 'memory'
      ttl: 300, // Default TTL in seconds
      redisUrl: process.env.REDIS_URL,
    }),
  ],
});
```

## License

Apache-2.0
