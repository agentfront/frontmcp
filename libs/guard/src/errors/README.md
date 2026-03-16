# errors

Standalone error hierarchy for `@frontmcp/guard`. All errors extend `GuardError`, which carries a machine-readable `code` string and an HTTP `statusCode` number. Consumers (such as `@frontmcp/sdk`) can catch `GuardError` and re-throw as protocol-specific errors if needed.

## Error Classes

| Class                   | Code                | Status Code | Description                                                                                                                                               |
| ----------------------- | ------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GuardError`            | (varies)            | (varies)    | Base class. Accepts `message`, `code`, `statusCode` in the constructor.                                                                                   |
| `ExecutionTimeoutError` | `EXECUTION_TIMEOUT` | `408`       | Thrown when an async execution exceeds its configured timeout. Includes `entityName` and `timeoutMs` properties.                                          |
| `ConcurrencyLimitError` | `CONCURRENCY_LIMIT` | `429`       | Thrown when all concurrency slots are occupied and queuing is disabled. Includes `entityName` and `maxConcurrent`.                                        |
| `QueueTimeoutError`     | `QUEUE_TIMEOUT`     | `429`       | Thrown when a request waited in the concurrency queue but the timeout expired before a slot became available. Includes `entityName` and `queueTimeoutMs`. |
| `IpBlockedError`        | `IP_BLOCKED`        | `403`       | Thrown when a client IP matches the deny list. Includes `clientIp`.                                                                                       |
| `IpNotAllowedError`     | `IP_NOT_ALLOWED`    | `403`       | Thrown when a client IP is not on the allow list and the default action is deny. Includes `clientIp`.                                                     |

## Usage

```typescript
import { GuardError, ExecutionTimeoutError } from '@frontmcp/guard';

try {
  // ... guarded operation
} catch (err) {
  if (err instanceof GuardError) {
    console.log(err.code); // e.g. 'EXECUTION_TIMEOUT'
    console.log(err.statusCode); // e.g. 408
  }
}
```

No external dependencies -- this module is pure TypeScript with no imports.
