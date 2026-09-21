# Cache Plugin

## Overview

### Purpose

Provides **transparent response caching** for tools based on their input payloads — reducing redundant computation and
improving response time.

### Storage

Supports **in-memory** caching out of the box and optional **Redis** backends. Choose `type: 'memory'`, `type: 'redis'`,
or `type: 'redis-client'` when registering the plugin.

### Keying

Cache entries are keyed using a **deterministic hash** of each tool’s validated input (`ctx.input`).

### Lifecycle Hooks

- **Before execution:** `ToolHook.Will('execute')` checks the cache store.
- **After execution:** `ToolHook.Did('execute')` writes new responses with the resolved TTL.

---

## 🔄 How It Works

1. Before a tool executes, the plugin hashes `ctx.input` and checks the configured store for a cached entry.
2. On a **cache hit**, the cached output is returned immediately, and a flag

   ```json
   { "___cached__": true }
   ```

   is added to the response (useful for debugging).

3. If no cached entry exists, the tool runs normally, and the output is stored with the resolved TTL.
4. When `slideWindow` is enabled, each read refreshes the TTL to keep hot entries alive.

---

## ⚙️ Requirements

- Memory mode (`type: 'memory'` or omitted) needs no external services; data resets when the process restarts.
- Redis mode (`type: 'redis'`) provisions a `CacheRedisProvider` using your host/port (optionally password/db).
- Redis client mode (`type: 'redis-client'`) reuses an existing `ioredis` client that you supply.
- Only enable caching for **deterministic** tools whose outputs depend solely on inputs.

---

## 🧩 Registering the Plugin

Assume your app class is decorated with `@App` and exposes a `plugins` array.

### 1. Default configuration (in-memory, 1-day TTL)

```ts
plugins: [CachePlugin];
```

### 2. Custom default TTL (memory)

```ts
plugins: [
  CachePlugin.init({
    type: 'memory',
    defaultTTL: 300, // 5 minutes
  }),
];
```

### 3. Redis connection via config

```ts
plugins: [
  CachePlugin.init({
    type: 'redis',
    defaultTTL: 600,
    config: {
      host: '127.0.0.1',
      port: 6379,
      // password, db optional
    },
  }),
];
```

### 4. Reuse an existing Redis client

```ts
plugins: [
  CachePlugin.init({
    type: 'redis-client',
    defaultTTL: 900,
    client: existingRedis,
  }),
];
```

---

## 🧠 Tool-Level Configuration

Caching is **opt-in** per tool. Add the `cache` field in your tool’s metadata.

### Minimal example

Uses plugin defaults.

```ts
@Tool({
  name: 'create-expense',
  cache: true,
})
export default class CreateExpenseTool extends ToolContext {
  // ...
}
```

### Custom TTL and sliding window

```ts
@Tool({
  name: 'get-expense-by-id',
  cache: {
    ttl: 60, // 1 minute
    slideWindow: true, // refresh TTL on read
  },
})
export default class GetExpenseTool extends ToolContext {
  // ...
}
```

---

## ⚖️ Behavior Details

| Behavior           | Description                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------------ |
| **Key Derivation** | SHA-256 of tool name + validated input + caller identity. `keyByIdentity: false` drops identity. |
| **Cache Hits**     | Adds `___cached__: true` to the output (for observability only).                                 |
| **Default TTL**    | Plugin `defaultTTL` → falls back to `86400` seconds (1 day).                                     |
| **Sliding Window** | Extends TTL on reads when `slideWindow` is true.                                                 |
| **Store Choice**   | Memory is node-local; Redis enables multi-instance sharing.                                      |

---

## 🧹 Invalidation Strategies

| Strategy                | Use When                   | Notes                                    |
| ----------------------- | -------------------------- | ---------------------------------------- |
| **Time-based**          | Data changes often         | Use short TTLs                           |
| **Input Shaping**       | Input determines freshness | Include the fields the result depends on |
| **Manual Invalidation** | You need explicit control  | Extend or wrap the plugin to delete keys |

---

## 🧩 Troubleshooting

| Symptom                              | Possible Cause                               | Fix                                                                |
| ------------------------------------ | -------------------------------------------- | ------------------------------------------------------------------ |
| No cache hits                        | Tool missing `cache` config or store offline | Add `cache: {}` to tool metadata and verify store connection       |
| Output unexpectedly cached           | Previous result reused                       | Lower TTL or modify input for unique cache key                     |
| Want one entry shared by all callers | Each caller is cached separately by default  | Set `keyByIdentity: false`, only for output identical for everyone |

---

## 🧾 Reference

### Plugin options (registration)

| Option       | Type                                             | Default    | Description                                        |
| ------------ | ------------------------------------------------ | ---------- | -------------------------------------------------- |
| `type`       | `'memory' \| 'redis' \| 'redis-client'`          | `'memory'` | Selects the backing store.                         |
| `defaultTTL` | `number`                                         | `86400`    | Default time-to-live (seconds).                    |
| `config`     | `{ host: string; port: number; password?; db? }` | —          | Redis connection details when `type: 'redis'`.     |
| `client`     | `Redis` (from `ioredis`)                         | —          | Existing Redis client when `type: 'redis-client'`. |

### Tool metadata (`@Tool` / `tool`)

| Option              | Type      | Description                           |
| ------------------- | --------- | ------------------------------------- |
| `cache`             | `true`    | Enable caching with plugin defaults.  |
| `cache.ttl`         | `number`  | Override TTL (seconds) for this tool. |
| `cache.slideWindow` | `boolean` | Refresh TTL on reads for this tool.   |
