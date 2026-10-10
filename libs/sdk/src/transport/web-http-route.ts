/**
 * The HTTP routes a scope registered (`http.routes`, channel webhooks), served on the web-fetch adapter.
 *
 * The Express host mounts each route on its router; a runtime with no route server runs the SAME
 * registered handler, whose guards (the `http:ip-filter` flow, and the `session:verify` flow for an
 * `auth: true` route) are already wrapped around it. The handler writes to a response that renders
 * as a Web `Response`, streamed as it is written.
 */
import { runRequestExclusive } from '@frontmcp/utils';

import { type ServerRequest } from '../common/interfaces/server.interface';
import { matchRoutePath } from '../flows/flow.http-path';
import { type RegisteredHttpRoute } from '../server/custom-routes.helper';
import { flowErrorToHttpOutput } from './flow-error-output';
import { decodeRelayChunk, RelayServerResponse } from './relay/relay-http';
import { renderHttpOutputToWebResponse } from './web-response.renderer';

const encoder = new TextEncoder();

/** Statuses whose response must not carry a body. */
const BODYLESS_STATUSES = new Set([101, 204, 205, 304]);

/** The first route registered for the request's method and path, with the path parameters it captured. */
function findRoute(
  routes: readonly RegisteredHttpRoute[],
  request: ServerRequest,
): { route: RegisteredHttpRoute; params: Record<string, string> } | undefined {
  for (const route of routes) {
    if (route.method !== request.method) continue;
    const params = matchRoutePath(route.path, request.path);
    if (params) return { route, params };
  }
  return undefined;
}

/** A response the handler writes to, and the Web `Response` it becomes once its head is written. */
function createWebRouteResponse(): { response: RelayServerResponse; rendered: Promise<Response> } {
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  const body = new ReadableStream<Uint8Array>({ start: (streamController) => (controller = streamController) });
  let resolveRendered: (response: Response) => void = () => undefined;
  const rendered = new Promise<Response>((resolve) => (resolveRendered = resolve));
  const response = new RelayServerResponse({
    head(status, headers) {
      const webHeaders = new Headers();
      for (const [name, value] of Object.entries(headers)) {
        for (const item of Array.isArray(value) ? value : [value]) webHeaders.append(name, item);
      }
      resolveRendered(new Response(BODYLESS_STATUSES.has(status) ? null : body, { status, headers: webHeaders }));
    },
    data(chunk) {
      const data = decodeRelayChunk(chunk);
      controller?.enqueue(typeof data === 'string' ? encoder.encode(data) : data);
    },
    end() {
      controller?.close();
    },
  });
  return { response, rendered };
}

/**
 * Serve the request with the route the scope registered for it. Returns `undefined` when no route
 * matches or the handler passes the request on with `next()`.
 */
export async function serveHttpRouteWeb(
  routes: readonly RegisteredHttpRoute[],
  request: ServerRequest,
): Promise<Response | undefined> {
  const match = findRoute(routes, request);
  if (!match) return undefined;
  request.params = { ...match.params, ...request.params };

  const { response, rendered } = createWebRouteResponse();
  let passOn: () => void = () => undefined;
  const passedOn = new Promise<undefined>((resolve) => (passOn = () => resolve(undefined)));
  try {
    await runRequestExclusive(async () => match.route.handler(request, response.asServerResponse(), passOn));
  } catch (error) {
    if (response.headersSent) {
      response.end();
      return rendered;
    }
    const output = flowErrorToHttpOutput(error);
    return output
      ? renderHttpOutputToWebResponse(output)
      : Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
  return Promise.race([rendered, passedOn]);
}
