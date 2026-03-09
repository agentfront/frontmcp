/**
 * Lifecycle stages for auth invocation.
 *
 * Ordering notes:
 * - "will*" stages run before the action; "did*" stages run after.
 * - Higher `priority()` runs earlier for "will*" (outermost), and later for "did*".
 * - Finalization stages (`willFinalize`, `willAudit`, `didAudit`, `onMetrics`) should be placed
 *   in your plan’s `finalize` array to run on both success and error paths.
 *
 * Control flow:
 * - Hooks may call `ctx.respond(value)` to short-circuit with a return value.
 * - Hooks may call `ctx.abort(reason, code?, httpStatus?)` to stop with an error.
 *
 */

export enum AuthHookStage {
  /** Prepare a new session (or re-register an incoming secureJwt).
   * Responsibilities:
   * - Validate incoming token (if any); compute defaults; attach user hints.
   * - Initialize per-session resources and attach to `ctx.data`.
   * Failure modes:
   * - `ctx.abort('invalid jwt', 'INVALID_SESSION', 401)`.
   */
  willCreateSession = 'willCreateSession',

  /** Session created and registered.
   * Responsibilities:
   * - Announce readiness (mount handlers/streams), emit side-effects if needed.
   * - Optionally shape `ctx.output` with a `SessionContextView`.
   */
  didCreateSession = 'didCreateSession',

  /** Bind DI providers needed for this session/request.
   * Responsibilities:
   * - Resolve and bind providers so later hooks can `ctx.get(...)`.
   * - May set `ctx.bindProvider/bindProviders` helpers.
   */
  willBindProviders = 'willBindProviders',

  // ---------- Auth (within a session) ----------

  /** Signal the beginning of an auth sequence in the scope of this session.
   * Responsibilities:
   * - Initialize auth-related state (PKCE/state, CSRF, telemetry).
   * - Decide transport (SSE/StreamableHTTP) for status/URL events if applicable.
   */
  willBeginAuth = 'willBeginAuth',

  /** Streamable authorization progress within the session.
   * Responsibilities:
   * - Emit URL/status events (e.g., “authorize_url”, “awaiting_callback”).
   * - Optionally `ctx.respond({event: ...})` for push-style transports.
   */
  willAuthorize = 'willAuthorize', // stream-able events (URL/status)

  /** Prepare and gate the token exchange with the provider.
   * Responsibilities:
   * - Verify callback params; ensure prerequisites (sessionId present).
   * - Compute exchange request; rate-limit/anti-replay checks.
   * Failure modes:
   * - `ctx.abort('invalid state/pkce', 'OAUTH_CALLBACK_ERROR', 400)`.
   */
  willExchangeToken = 'willExchangeToken',

  /** SecureMcp JWT has been minted/confirmed for this session.
   * Responsibilities:
   * - React to issuance (e.g., persist session claims, notify listeners).
   * Notes:
   * - Fired once the session’s secureJwt is known; avoid logging secrets.
   */
  didIssueSecureJwt = 'didIssueSecureJwt',

  /** Encrypt and store provider tokens for this session.
   * Responsibilities:
   * - Write encrypted blobs to the session record (per provider).
   * - Derive minimal metadata (scopes/expiry) for later claims-only exposure.
   */
  willStoreTokens = 'willStoreTokens',

  // ---------- Access (read path) ----------

  /** Authorize and prepare a session read.
   * Responsibilities:
   * - Validate access to the session; attach read-scoped providers if required.
   * - Optionally shape a partial view before execute.
   */
  willGetSession = 'willGetSession',

  /** Post-process the session view.
   * Responsibilities:
   * - Redact/transform/derive fields for the final response.
   * - Set `ctx.output` to a `SessionContextView`.
   */
  didGetSession = 'didGetSession',

  // ---------- Disposal ----------

  /** Announce shutdown and allow flush/cleanup.
   * Responsibilities:
   * - Close streams, unsubscribe listeners, schedule disposers.
   */
  willDisposeSession = 'willDisposeSession',

  /** Confirm teardown and emit metrics.
   * Responsibilities:
   * - Final confirmation of resource release; summarize outcome.
   */
  didDisposeSession = 'didDisposeSession',

  // ---------- Finalize / audit / metrics / errors ----------

  /** Optional “late finally” hook if you need a single place before audit/metrics.
   * Responsibilities:
   * - Last-chance cleanup across success/error paths (idempotent, non-throwing).
   * Notes:
   * - Include this stage in your plan’s `finalize` array to activate.
   */
  willFinalize = 'willFinalize',

  /** Centralized error handler.
   * Responsibilities:
   * - Redact sensitive data; map internal errors to public codes.
   * - Optionally `ctx.respond({ error })` or `ctx.abort(...)`.
   * Notes:
   * - Should not throw; runs before audit/metrics finalize.
   */
  onError = 'onError',

  /** Pre-audit collection on both success and error paths.
   * Responsibilities:
   * - Build audit envelope (actor, sessionId, providers touched).
   * - Normalize and strip secrets (no raw tokens).
   */
  willAudit = 'willAudit',

  /** Persist/emit the audit record.
   * Responsibilities:
   * - Write to audit sink(s) with outcome and timings.
   * - Correlate via `ctx.requestId`/`ctx.sessionId`.
   */
  didAudit = 'didAudit',

  /** Telemetry/metrics emission for both success and errors.
   * Responsibilities:
   * - Counters & timings (create/get/dispose/auth/exchange/store).
   * - Error code/tag cardinality kept small for SLOs/alerts.
   * Constraints:
   * - Non-throwing; must not alter control flow.
   */
  onMetrics = 'onMetrics',
}
