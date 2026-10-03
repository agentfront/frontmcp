/**
 * Map an error thrown out of a flow run to the normalized `HttpOutput` an adapter renders.
 *
 * Shared by the adapters that run HTTP flows without the Express middleware (the
 * web-fetch / Worker handler and the distributed request relay), so a flow failure
 * answers the same way on every one of them.
 */
import { FlowControl } from '../common';
import { type HttpOutput } from '../common/schemas/http-output.schema';
import { PublicMcpError } from '../errors';
import { findMisconfiguration, misconfigurationBody } from '../errors/misconfiguration';

/**
 * Map an error thrown out of `runFlow('http:request', …)` to a normalized
 * `HttpOutput`, mirroring the Express middleware's FlowControl handling. Returns
 * `undefined` for `next`/`handled` (no response → the caller 404s).
 */
export function flowErrorToHttpOutput(error: unknown): HttpOutput | undefined {
  // #546 — a deployment that is merely missing a secret used to answer a bare
  // `Internal Server Error`, so the only way to learn the cause was to tail the
  // live worker. Report the configuration fault instead.
  const misconfiguration = findMisconfiguration(error);
  if (misconfiguration) {
    return {
      kind: 'json',
      status: 500,
      contentType: 'application/json; charset=utf-8',
      body: misconfigurationBody(misconfiguration),
    };
  }

  if (error instanceof FlowControl) {
    switch (error.type) {
      case 'respond':
        return error.output as HttpOutput;
      case 'next':
      case 'handled':
        return undefined;
      default: // 'abort' | 'fail'
        return { kind: 'text', status: 500, body: 'Internal Server Error', contentType: 'text/plain; charset=utf-8' };
    }
  }
  if (error instanceof PublicMcpError) {
    const challenge = error.wwwAuthenticate;
    return {
      kind: 'json',
      status: error.statusCode,
      contentType: 'application/json; charset=utf-8',
      body: { error: error.getPublicMessage() },
      ...(typeof challenge === 'string' && challenge.length > 0 ? { headers: { 'WWW-Authenticate': challenge } } : {}),
    };
  }
  return { kind: 'text', status: 500, body: 'Internal Server Error', contentType: 'text/plain; charset=utf-8' };
}
