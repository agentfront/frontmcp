# Cache Plugin

## Overview

### Purpose

Provides **transparent response caching** for tools based on their input payloads — reducing redundant computation and
improving response time.

### Storage

Uses **Redis** as the backing store, managed by the plugin’s own providers.

### Keying

Cache entries are keyed using a **deterministic hash** of each tool’s input (`ctx.input`).

### Lifecycle Hooks

- **Before execution:** Reads from cache (`willReadCache`).
- **After execution:** Writes new responses to cache (`willWriteCache`).

---

## 🔄 How It Works

1. Before a tool executes, the plugin computes a **stable hash** of `ctx.input` and checks Redis for a cached entry.
2. On a **cache hit**, the cached output is returned immediately, and a flag

   ```json
   { "___cached__": true }
   ```

   is added to the response (useful for debugging).

3. If no cached entry exists, the tool runs normally, and the output is stored in Redis with a **TTL (time-to-live)**.
4. When `slideWindow` is enabled, each read **refreshes the TTL**.

---

## ⚙️ Requirements

- A running **Redis** instance accessible to your server.
- No extra setup — the plugin registers its own providers:

  - `CacheRedisProvider`
  - `CacheConfigProvider`

- Only enable caching for **deterministic** tools (outputs that depend solely on inputs).

---

## 🧩 Registering the Plugin

Assume your app class is decorated with `@McpApp` and exposes a `plugins` array.

### 1. Default Configuration (1-day TTL)

```ts
plugins: [CachePlugin];
```

### 2. Custom Default TTL (in seconds)

Set a fixed TTL for all tools without providers.

```ts
plugins: [
  CachePlugin.init({
    defaultTTL: 300, // 5 minutes
  }),
];
```

### 3. Dynamic Configuration via Factory

Use when your server already provides a configuration service.

```ts
plugins: [
  CachePlugin.init({
    inject: () => [ExpenseConfigProvider],
    useFactory: (config: ExpenseConfigProvider) => ({
      defaultTTL: config.get<number>('cache.defaultTTL'),
    }),
  }),
];
```

---

## 🧠 Tool-Level Configuration

Caching is **opt-in** per tool. Add the `cache` field in your tool’s metadata.

### Minimal Example

Uses plugin defaults.

```ts
@McpTool({
  name: 'create-expense',
  cache: true,
})
```

### Custom TTL and Sliding Window

```ts
@McpTool({
  name: 'get-expense-by-id',
  cache: {
    ttl: 60,          // 1 minute
    slideWindow: true // refresh TTL on read
  },
})
```

---

## ⚖️ Behavior Details

| Behavior           | Description                                                            |
| ------------------ | ---------------------------------------------------------------------- |
| **Key Derivation** | Deterministic hash from `ctx.input`. Changing input changes cache key. |
| **Cache Hits**     | Adds `___cached__: true` to the output (for observability only).       |
| **Default TTL**    | Plugin defaultTTL → falls back to `86400` seconds (1 day).             |
| **Sliding Window** | Extends TTL on reads when `slideWindow` is true.                       |

---

## 🧹 Invalidation Strategies

| Strategy                | Use When                   | Notes                                         |
| ----------------------- | -------------------------- | --------------------------------------------- |
| **Time-based**          | Data changes often         | Use short TTLs                                |
| **Input Shaping**       | Input determines freshness | Include relevant identifiers in input         |
| **Manual Invalidation** | You need explicit control  | Extend or wrap plugin to delete keys manually |

---

## 🧩 Troubleshooting

| Symptom                     | Possible Cause                                   | Fix                                                          |
| --------------------------- | ------------------------------------------------ | ------------------------------------------------------------ |
| No cache hits               | Tool missing `cache` config or Redis unavailable | Add `cache: {}` to tool metadata and verify Redis connection |
| Output unexpectedly cached  | Previous result reused                           | Lower TTL or modify input for unique cache key               |
| Need tenant/session scoping | Same input shared across tenants                 | Include tenant/session IDs in input payload                  |

---

## 🧾 Reference

### Plugin Options (registration)

| Option       | Type     | Default | Description                       |
| ------------ | -------- | ------- | --------------------------------- |
| `defaultTTL` | `number` | `86400` | Default time-to-live (in seconds) |

### Tool Metadata Options (`@McpTool`)

| Option        | Type      | Description              |
| ------------- | --------- | ------------------------ |
| `ttl`         | `number`  | Custom TTL for this tool |
| `slideWindow` | `boolean` | Refresh TTL on reads     |
