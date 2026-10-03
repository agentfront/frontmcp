/**
 * Owner-side adapter for relayed requests.
 *
 * Like every other adapter, it only translates: the relayed request arrives as a
 * normalized `ServerRequest` + `ServerResponse` pair and runs through the SAME
 * `http:request` flow a request received directly runs through (IP filter, quota,
 * session verification, routing, the MCP transport, audit and every hook), so the
 * owner serves it exactly as if the client had reached it.
 */

import type { ServerRequest, ServerResponse } from '../../common';
import type { HttpOutput } from '../../common/schemas/http-output.schema';
import { writeHttpResponse } from '../../server/server.validation';
import { flowErrorToHttpOutput } from '../flow-error-output';

/** The part of the scope the adapter needs. */
export interface RelayFlowRunner {
  runFlow(name: 'http:request', input: never): Promise<unknown>;
}

/** Run a relayed request through the `http:request` flow and render its output to `response`. */
export async function serveRelayedHttpRequest(
  scope: RelayFlowRunner,
  request: ServerRequest,
  response: ServerResponse,
): Promise<void> {
  let output: HttpOutput | undefined;
  try {
    output = (await scope.runFlow('http:request', { request, response } as never)) as HttpOutput | undefined;
  } catch (error) {
    output = flowErrorToHttpOutput(error);
  }

  if (output && !response.writableEnded) {
    await writeHttpResponse(response, output);
  }
  if (response.writableEnded) return;

  if (!response.headersSent) {
    // No stage claimed the request — what the Express host answers for an unrouted path.
    await writeHttpResponse(response, {
      kind: 'json',
      status: 404,
      contentType: 'application/json; charset=utf-8',
      body: { error: 'Not Found' },
    });
    return;
  }
  response.end();
}
