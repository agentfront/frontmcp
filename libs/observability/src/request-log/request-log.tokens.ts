/**
 * DI token for the RequestLogCollector.
 *
 * Used as a CONTEXT-scoped provider — one collector per request.
 * The symbol ensures uniqueness across packages.
 */
export const REQUEST_LOG_COLLECTOR = Symbol.for('frontmcp:observability:request-log-collector');
