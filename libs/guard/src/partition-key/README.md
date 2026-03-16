# partition-key

Partition key resolution for request bucketing in rate limiting and concurrency control.

## Strategies

A partition key determines how requests are grouped into buckets. Built-in strategies:

| Strategy    | Key Source                            | Fallback            |
| ----------- | ------------------------------------- | ------------------- |
| `'global'`  | Returns the literal string `'global'` | --                  |
| `'ip'`      | `context.clientIp`                    | `'unknown-ip'`      |
| `'session'` | `context.sessionId`                   | -- (always present) |
| `'userId'`  | `context.userId`                      | `context.sessionId` |

If `partitionBy` is `undefined`, it defaults to `'global'`.

## Custom Functions

You can pass a function `(ctx: PartitionKeyContext) => string` for arbitrary bucketing:

```typescript
const partitionBy = (ctx: PartitionKeyContext) => `tenant:${ctx.userId?.split(':')[0]}`;
```

## Exports

- `resolvePartitionKey(partitionBy, context)` -- resolves a partition key string from a strategy and context
- `buildStorageKey(entityName, partitionKey, suffix?)` -- builds a colon-separated storage key (e.g., `my-tool:user-42:rl`)
- `PartitionKeyStrategy` -- union type of built-in strategy strings
- `CustomPartitionKeyFn` -- custom resolver function type
- `PartitionKeyContext` -- context interface (`sessionId`, `clientIp?`, `userId?`)
- `PartitionKey` -- union of `PartitionKeyStrategy | CustomPartitionKeyFn`

## Usage

```typescript
import { resolvePartitionKey, buildStorageKey } from '@frontmcp/guard';

const pk = resolvePartitionKey('session', { sessionId: 'sess-42' });
// 'sess-42'

const storageKey = buildStorageKey('my-tool', pk, 'rl');
// 'my-tool:sess-42:rl'
```
