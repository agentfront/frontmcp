import { PEOPLE_SESSION_COOKIE, type PeopleSession } from '@frontmcp/auth';
import { internalZ as z } from '@frontmcp/lazy-zod';
import { getCookie } from '@frontmcp/utils';

import {
  enforceGlobalRateLimit,
  enforceIpFilter,
  Flow,
  FlowBase,
  FlowHooksOf,
  httpInputSchema,
  httpOutputSchema,
  httpRespond,
  type FlowPlan,
  type FlowRunOptions,
  type HttpOutput,
  type HttpRouteInterface,
  type HttpRouteResult,
  type HttpRouteSseOptions,
  type ScopeEntry,
  type ServerRequest,
} from '../../common';
import { CrossOriginRequestError, PersonNotSignedInError } from '../../errors';
import { FlowContextProviders } from '../../provider/flow-context-providers';
import { corsAllowedOrigins } from '../../server/security/resolve-allowed-hosts';
import { isSameOriginRequest } from '../../server/security/same-origin';
import { type HttpRouteEntry } from '../http-route.table';
import { SseRouteStream } from '../sse-route.stream';

const plan = {
  pre: ['checkIpFilter', 'findRoute', 'acquireQuota', 'checkSameOrigin', 'authenticatePerson'],
  execute: ['handle'],
} as const satisfies FlowPlan<string>;

export const httpRouteStateSchema = z.object({
  route: z.custom<HttpRouteEntry>(),
  person: z.custom<PeopleSession>().optional(),
});

declare global {
  interface ExtendFlows {
    'http:route': FlowRunOptions<
      HttpRouteFlow,
      typeof plan,
      typeof httpInputSchema,
      typeof httpOutputSchema,
      typeof httpRouteStateSchema
    >;
  }
}

const name = 'http:route' as const;
const { Stage } = FlowHooksOf(name);

const MUTATIONS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
/** A `next` or `consumed` output would leave the request unanswered: a route's value is sent as JSON instead. */
function isResponse(result: object): result is HttpOutput {
  const kind = (result as { kind?: unknown }).kind;
  return kind !== 'next' && kind !== 'consumed' && httpOutputSchema.safeParse(result).success;
}

function toHttpOutput(result: HttpRouteResult): HttpOutput {
  if (result === undefined) return httpRespond.noContent();
  if (typeof result === 'string') {
    return { kind: 'text', status: 200, body: result, contentType: 'text/plain; charset=utf-8' };
  }
  if (isResponse(result)) return result;
  return {
    kind: 'json',
    status: 200,
    body: result as Record<string, unknown>,
    contentType: 'application/json; charset=utf-8',
  };
}

/**
 * Serves an `@HttpRoute`: the IP filter, the global rate limit, a same-origin check on mutations, people auth, then
 * the route's `handle()` with its app's providers. Every adapter runs it: the Express host mounts it ahead of the MCP
 * endpoint, and the fetch handler runs it before dispatching any other flow.
 */
@Flow({
  name,
  plan,
  access: 'public',
  inputSchema: httpInputSchema,
  outputSchema: httpOutputSchema,
  middleware: {},
})
export default class HttpRouteFlow extends FlowBase<typeof name> {
  static canActivate(request: ServerRequest, scope: ScopeEntry): boolean {
    return scope.httpRouteTable?.match(request) !== undefined;
  }

  private get httpRequest(): ServerRequest {
    return this.rawInput.request as ServerRequest;
  }

  @Stage('checkIpFilter')
  async checkIpFilter() {
    enforceIpFilter(this.scope, this.tryGetContext()?.metadata.clientIp);
  }

  @Stage('findRoute')
  async findRoute() {
    const match = this.scope.httpRouteTable?.match(this.httpRequest);
    if (!match) return this.next();
    this.httpRequest.params = { ...match.params, ...this.httpRequest.params };
    this.state.set('route', match.route);
  }

  @Stage('acquireQuota')
  async acquireQuota() {
    await enforceGlobalRateLimit(this.scope, this.tryGetContext());
  }

  @Stage('checkSameOrigin')
  async checkSameOrigin() {
    if (!MUTATIONS.has(this.httpRequest.method)) return;
    const http = this.scope.metadata.http;
    const allowed = [
      ...(corsAllowedOrigins(http?.cors) ?? []),
      ...(http?.security?.dnsRebindingProtection?.allowedOrigins ?? []),
    ];
    if (!isSameOriginRequest(this.httpRequest.headers, allowed)) throw new CrossOriginRequestError();
  }

  @Stage('authenticatePerson')
  async authenticatePerson() {
    if (this.state.required.route.auth !== 'people') return;
    const cookie = getCookie(this.httpRequest.headers['cookie'], PEOPLE_SESSION_COOKIE);
    const person = this.scope.httpRouteTable?.people?.verifySession(cookie);
    if (!person) throw new PersonNotSignedInError();
    this.state.set('person', person);
  }

  @Stage('handle')
  async handle() {
    const { route } = this.state.required;
    const { person } = this.state;
    const sessionKey = this.tryGetContext()?.sessionId ?? 'anonymous';
    const views = await route.providers.buildViews(sessionKey, new Map(this.deps), this.scope.providers);
    const context = new route.target({
      providers: new FlowContextProviders(route.providers, views.context),
      logger: this.scope.logger.child(`HttpRoute ${route.method} ${route.path}`),
      authInfo: {},
      request: this.httpRequest,
      person,
    });
    this.respond(route.sse ? this.openStream(route, route.sse, context) : toHttpOutput(await context.handle()));
  }

  private openStream(
    route: HttpRouteEntry,
    sse: Required<HttpRouteSseOptions>,
    context: HttpRouteInterface,
  ): HttpOutput {
    const table = this.scope.httpRouteTable;
    const stream: SseRouteStream = new SseRouteStream({
      produce: async () => context.handle(),
      subscribe: (listener) => {
        const stops = sse.topics.map((topic) => sse.store.subscribe(topic, listener));
        return () => stops.forEach((stop) => stop());
      },
      coalesceMs: sse.coalesceMs,
      heartbeatMs: sse.heartbeatMs,
      onError: (error) =>
        this.scope.logger.warn(`SSE route ${route.method} ${route.path} failed to make its view`, error),
      onClose: () => table?.untrack(stream),
    });
    table?.track(stream);
    return {
      kind: 'sse',
      status: 200,
      stream,
      contentType: 'text/event-stream',
      disposition: 'inline',
      headers: { 'X-Accel-Buffering': 'no', Connection: 'close' },
    };
  }
}
