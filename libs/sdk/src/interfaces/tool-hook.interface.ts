/**
 * Lifecycle stages for tool invocation.
 *
 * Ordering notes:
 * - "will*" stages run before the action; "did*" run after.
 * - Higher `priority()` runs earlier for "will*" (outermost for wrappers), and later for "did*".
 * - `aroundExecute` wraps the actual execution block (including will/didExecute inside).
 *
 * Control flow:
 * - Hooks may call `ctx.respond(value)` to short-circuit with a value.
 * - Hooks may call `ctx.abort(reason, code?, httpStatus?)` to deny/stop.
 * - Hooks may call `ctx.retryAfter(ms, reason?)` to signal backoff.
 */
export enum ToolHookStage {
  /** Bind DI providers needed for this invocation (from ctor tokens + hook/tool `provide()`).
   * Runs very early so later hooks can use `ctx.get(...)`. */
  willBindProviders = 'willBindProviders',

  /** Last chance to populate/shape the invocation context (user, tenant, attrs, ids). */
  willCreateInvokeContext = 'willCreateInvokeContext',

  /** Post-context creation; good for sanity checks, tracing decorations. */
  didCreateInvokeContext = 'didCreateInvokeContext',

  /** Authorization gate (roles/scopes/RBAC/ABAC). May `abort()` if unauthorized. */
  willAuthorize = 'willAuthorize',

  /** Consent gate. May `respond()` with a consent challenge or `abort()` if missing consent. */
  willCheckConsent = 'willCheckConsent',

  /** Feature-flag gate (enable/disable per user/tenant/experiment). May `abort()`. */
  willCheckFeatureFlags = 'willCheckFeatureFlags',

  // ---------------- Capacity & Resilience ----------------

  /** Acquire rate-limit quota. May `retryAfter()` or `abort()` on exhaustion. */
  willAcquireQuota = 'willAcquireQuota',

  /** Release rate-limit quota (best-effort; typically run in `finally`). */
  didReleaseQuota = 'didReleaseQuota',

  /** Acquire concurrency slot/semaphore. May `retryAfter()` or `abort()`. */
  willAcquireSemaphore = 'willAcquireSemaphore',

  /** Release concurrency slot/semaphore (best-effort). */
  didReleaseSemaphore = 'didReleaseSemaphore',

  // ---------------- Input shaping ----------------

  /** Parse/coerce raw input (types, defaults). Mutate `ctx.input` as needed. */
  willParseInput = 'willParseInput',

  /** Validate business rules for input. May `abort()` on violations. */
  willValidateInput = 'willValidateInput',

  /** Normalize/canonicalize input (ids → uuids, trim, sort fields, etc.). */
  willNormalizeInput = 'willNormalizeInput',

  /** Apply DLP/minimization to input (mask/drop/hash fields). */
  willRedactInput = 'willRedactInput',

  /** Inject credentials/secrets (tokens, API keys) into context or input. */
  willInjectSecrets = 'willInjectSecrets',

  // ---------------- Caching ----------------

  /** Attempt to serve from cache. May `respond(cachedValue)` to short-circuit. */
  willReadCache = 'willReadCache',

  /** Metrics/telemetry for cache hit; typically emitted by cache plugin. */
  didCacheHit = 'didCacheHit',

  /** Metrics/telemetry for cache miss; typically emitted by cache plugin. */
  didCacheMiss = 'didCacheMiss',

  /** Write result to cache after successful execution. */
  willWriteCache = 'willWriteCache',

  // ---------------- Execution ----------------

  /** Around wrapper for execution (timeouts/retries/circuit/tracing). Must call `next()` unless short-circuiting. */
  aroundExecute = 'aroundExecute',

  /** Right before calling the tool implementation; may mutate `ctx.input`. */
  willExecute = 'willExecute',

  /** Right after tool returns; `ctx.output` is available for downstream hooks. */
  didExecute = 'didExecute',

  // ---------------- Output shaping ----------------

  /** Apply DLP/minimization to output (mask/drop/truncate sensitive fields). */
  willRedactOutput = 'willRedactOutput',

  /** Validate output against business/schema rules. May `abort()` or fix. */
  willValidateOutput = 'willValidateOutput',

  /** Transform output shape (projection/mapping/pagination). Mutate `ctx.output`. */
  willTransformOutput = 'willTransformOutput',

  // ---------------- Retry & Observability ----------------

  /** Called on each retry attempt by a retry wrapper (emit metrics/backoff hints). */
  onRetry = 'onRetry',

  /** Called when retries are exhausted and execution gives up. */
  onGiveUp = 'onGiveUp',

  /** Prepare audit payload (apply redaction) and/or write audit logs. */
  willAudit = 'willAudit',

  /** Post-audit hook (confirm persistence, forward to sinks). */
  didAudit = 'didAudit',

  /** Emit metrics (counters, histograms, traces). */
  onMetrics = 'onMetrics',

  // ---------------- Error & Finalization ----------------

  /** Error handler for unexpected failures or control errors. Can map/normalize errors. */
  onError = 'onError',

  /** Always runs at the very end (success or error). Cleanup/releases here. */
  willFinalizeInvoke = 'willFinalizeInvoke',
}
