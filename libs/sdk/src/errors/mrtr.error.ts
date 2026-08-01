/**
 * Multi Round-Trip Requests (MRTR) signals — protocol 2026-07-28, SEP-2322.
 *
 * 2026-07-28 removed the server→client request direction. When a server needs
 * sampling, elicitation, or roots it can no longer ask inline; it answers the
 * ORIGINAL request with an `InputRequiredResult` and the client retries with
 * the answers attached.
 *
 * These are control-flow signals, not failures: `InputRequiredSignal` unwinds
 * the tool out of `execute()` so the dispatcher can turn the pending request
 * into an interim result.
 */

import type { InputRequests } from '@frontmcp/protocol';

import { PublicMcpError } from './mcp.error';

/**
 * Raised when execution cannot continue without client-supplied input.
 *
 * Carries the requests to embed in `InputRequiredResult.inputRequests` plus the
 * opaque `requestState` the client must echo back on the retry.
 */
export class InputRequiredSignal extends PublicMcpError {
  constructor(
    /** Server-assigned keys → the request each one stands for. */
    public readonly inputRequests: InputRequests,
    /** Opaque blob the client returns verbatim; encodes answers gathered so far. */
    public readonly requestState: string,
  ) {
    super('Additional input required', 'INPUT_REQUIRED', 200);
  }
}

/**
 * Raised when a request needs a client capability the client did not declare.
 *
 * Under 2026-07-28 capabilities are per-request, so this is a plain validation
 * failure (`400` + `-32021`) rather than a session-level negotiation problem.
 */
export class MissingClientCapabilityError extends PublicMcpError {
  constructor(
    /** The capability set the server needs, in `ClientCapabilities` shape. */
    public readonly requiredCapabilities: Record<string, unknown>,
    message = 'Request requires a client capability that was not declared',
  ) {
    super(message, 'MISSING_REQUIRED_CLIENT_CAPABILITY', 400);
  }
}
