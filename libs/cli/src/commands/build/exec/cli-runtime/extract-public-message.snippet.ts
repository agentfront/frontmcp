/**
 * CLI-bundle source for `_extractPublicMessage` / `_exitWithError`.
 *
 * The SEA CLI bundle has to be self-contained — it can't reach into
 * `@frontmcp/sdk` at runtime — so we duplicate the SDK's
 * `extractPublicMessage` walker into the generated source. To prevent the
 * two implementations from drifting, the duplicated source lives in this
 * file as a string constant and is shared by:
 *
 *   - `generateCliEntry.ts`           (embeds it in the generated CLI source)
 *   - `extract-public-message-parity.spec.ts` (parity-tests it against
 *      the SDK's TS implementation using shared fixtures)
 *
 * Keep the function bodies free of TS / ESM-only syntax — the resulting
 * string is concatenated into a CommonJS bundle and `Function('return …')`
 * compiles it as plain ES2020.
 */
export const EXTRACT_PUBLIC_MESSAGE_SNIPPET = `
// Walk an error chain (cause / originalError) and return the most user-friendly
// message — prefers PublicMcpError.getPublicMessage() over wrapped wrappers like
// "Tool 'X' execution failed: Unknown error". Mirrors @frontmcp/sdk's
// extractPublicMessage so the SEA bundle stays self-contained. Cycles in the
// chain are short-circuited via a WeakSet of already-visited error objects.
function _extractPublicMessage(err) {
  return _extractPublicMessageImpl(err, new WeakSet());
}
function _extractPublicMessageImpl(err, visited) {
  if (err && typeof err === 'object') {
    if (visited.has(err)) return 'Unknown error';
    visited.add(err);
  }
  if (err == null) return 'Unknown error';
  if (typeof err === 'string') return err;
  // Direct PublicMcpError (has isPublic === true and a non-default message)
  if (err && err.isPublic === true && err.message) return err.message;
  // Wrapped: try originalError, then cause.
  var inner = err && (err.originalError || err.cause);
  if (inner) {
    var innerMsg = _extractPublicMessageImpl(inner, visited);
    if (innerMsg && innerMsg !== 'Unknown error') return innerMsg;
  }
  // Fallback: own .message, but skip generic wrappers when we have nothing better.
  if (err.message) return err.message;
  return String(err);
}
// Print an error with the best available public message and set the appropriate
// exit code (1 = runtime error, 2 = usage error). Centralized so every action
// handler reports the same shape.
function _exitWithError(err, code) {
  var msg = _extractPublicMessage(err);
  console.error('Error: ' + msg);
  process.exitCode = code || 1;
}
`.trim();
