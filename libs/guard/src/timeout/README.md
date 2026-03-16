# timeout

Async execution timeout wrapper.

## How It Works

The `withTimeout` function wraps an async function with a deadline using `AbortController` + `Promise.race`. A timer is started; if it fires before the function resolves, an `ExecutionTimeoutError` is thrown. The timer is always cleaned up in a `finally` block regardless of outcome.

## Exports

- `withTimeout` -- the timeout wrapper function
- `TimeoutConfig` -- configuration type (`executeMs`)

## Usage

```typescript
import { withTimeout } from '@frontmcp/guard';

const result = await withTimeout(
  () => fetchRemoteData(),
  5_000, // timeout in ms
  'fetch-remote', // entity name (used in error message)
);
```

If the function does not complete within 5 seconds, an `ExecutionTimeoutError` is thrown with code `EXECUTION_TIMEOUT` and HTTP status `408`.

## No External Dependencies

This module is pure TypeScript. It uses the built-in `AbortController` and `Promise.race` -- no storage adapter required.
