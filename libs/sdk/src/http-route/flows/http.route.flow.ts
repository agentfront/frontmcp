import { PEOPLE_SESSION_COOKIE, type PeopleSession } from '@frontmcp/auth';
import { internalZ as z } from '@frontmcp/lazy-zod';
import type { AuthInfo } from '@frontmcp/protocol';
import { getCookie } from '@frontmcp/utils';

import {
  authInfoFromAuthorization,
  challengeHeaders,
  enforceGlobalRateLimit,
  enforceIpFilter,
  Flow,
  FlowBase,
  FlowControl,
  FlowHooksOf,
  httpInputSchema,
  httpOutputSchema,
  httpRespond,
  isProxyTrusted,
  type FlowPlan,
  type FlowRunOptions,
  type HttpOutput,
  type HttpRouteAuth,
  type HttpRouteInterface,
  type HttpRouteResult,
  type HttpRouteSseOptions,
  type ScopeEntry,
  type ServerRequest,
} from '../../common';
import { CrossOriginRequestError, InvalidHttpRouteResponseError, PersonNotSignedInError } from '../../errors';
import { FlowContextProviders } from '../../provider/flow-context-providers';
import { corsAllowedOrigins } from '../../server/security/resolve-allowed-hosts';
import { isSameOriginRequest } from '../../server/security/same-origin';
import { type HttpRouteEntry } from '../http-route.table';
import { SseRouteStream } from '../sse-route.stream';

const plan = {
  pre: [
    'checkIpFilter',
    'findRoute',
    'acquireQuota',
    'checkSameOrigin',
    'authenticatePerson',
    'authenticateBearer',
    'checkAuthorities',
  ],
  execute: ['handle'],
} as const satisfies FlowPlan<string>;

export const httpRouteStateSchema = z.object({
  route: z.custom<HttpRouteEntry>(),
  person: z.custom<PeopleSession>().optional(),
  // The caller the server's auth verified, on an `auth: 'bearer'` route.
  caller: z.custom<Partial<AuthInfo>>().optional(),
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

/**
 * The kinds of output that answer a request. A `next` or `consumed` output would leave the request unanswered, so a
 * route's value of that kind is sent as JSON.
 */
const RESPONSE_KINDS: ReadonlySet<string> = new Set(
  Object.keys({
    redirect: true,
    json: true,
    text: true,
    html: true,
    binary: true,
    image: true,
    stream: true,
    sse: true,
    jsonrpc: true,
    problem: true,
    empty: true,
    'web-response': true,
  } satisfies Record<Exclude<HttpOutput['kind'], 'next' | 'consumed'>, true>),
);

/**
 * Serves an `@HttpRoute`: the IP filter, the global rate limit, a same-origin check on mutations, people or bearer
 * auth, the route's `authorities`, then the route's `handle()` with its app's providers. Every adapter runs it: the
 * Express host mounts it ahead of the MCP endpoint, and the fetch handler runs it before dispatching any other flow.
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
    if (!isSameOriginRequest(this.httpRequest.headers, allowed, isProxyTrusted())) throw new CrossOriginRequestError();
  }

  @Stage('authenticatePerson')
  async authenticatePerson() {
    const { auth } = this.state.required.route;
    if (auth === 'public' || auth === 'bearer') return;
    const person = await this.verifyPerson(auth);
    if (!person) throw new PersonNotSignedInError();
    this.state.set('person', person);
  }

  /** On an `auth: 'bearer'` route, admit the caller the MCP endpoint's auth admits, with its 401 or 403 otherwise. */
  @Stage('authenticateBearer')
  async authenticateBearer() {
    if (this.state.required.route.auth !== 'bearer') return;
    const verified = await this.scope.runFlow('session:verify', {
      request: this.httpRequest as unknown as Record<string, unknown>,
      sessionless: true,
    });
    if (verified?.kind !== 'authorized') {
      const headers = challengeHeaders(verified?.prmMetadataHeader);
      this.respond(
        verified?.kind === 'forbidden' ? httpRespond.forbidden({ headers }) : httpRespond.unauthorized({ headers }),
      );
      return;
    }
    const caller = authInfoFromAuthorization(verified.authorization);
    this.tryGetContext()?.recordAuthorization(caller);
    this.state.set('caller', caller);
  }

  /** Check the route's `authorities` for the bearer caller, with the body's fields and path parameters as input. */
  @Stage('checkAuthorities')
  async checkAuthorities() {
    const { route } = this.state.required;
    if (route.authorities === undefined) return;
    const engine = this.scope.authoritiesEngine;
    const contextBuilder = this.scope.authoritiesContextBuilder;
    const result =
      engine && contextBuilder
        ? await engine.evaluate(
            route.authorities,
            contextBuilder.build(this.state.caller ?? {}, authoritiesInput(this.httpRequest)),
          )
        : undefined;
    if (result?.granted) return;
    this.scope.logger.verbose(
      `HTTP route ${route.method} ${route.path} refused a caller: ${result?.deniedBy ?? 'no authorities engine'}`,
    );
    this.respond(httpRespond.forbidden());
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
      authInfo: this.state.caller ?? {},
      request: this.httpRequest,
      person,
    });
    // `authorities.pipes` may be async: run them before `handle()` reads `this.auth`, as a tool's flow does.
    if (route.auth === 'bearer') await (context as { loadAuthContext?: () => Promise<void> }).loadAuthContext?.();
    this.respond(
      route.sse ? this.openStream(route, route.sse, context) : this.toHttpOutput(route, await context.handle()),
    );
  }

  /**
   * What `handle()` returned, as the response. A value with a response `kind` that is valid for that kind is a
   * response, with the kind's defaults (a redirect without a `status` is a 302). One that is not valid and has a
   * `status`, as every `httpRespond` output has, fails (#1053); other objects are data.
   */
  private toHttpOutput(route: HttpRouteEntry, result: HttpRouteResult): HttpOutput {
    if (result === undefined) return httpRespond.noContent();
    if (typeof result === 'string') {
      return { kind: 'text', status: 200, body: result, contentType: 'text/plain; charset=utf-8' };
    }
    const kind = (result as { kind?: unknown }).kind;
    const parsed =
      typeof kind === 'string' && RESPONSE_KINDS.has(kind) ? httpOutputSchema.safeParse(result) : undefined;
    if (parsed?.success) return parsed.data;
    if (parsed && 'status' in result) {
      const problems = parsed.error.issues.map((issue) => `${issue.path.join('.') || 'kind'}: ${issue.message}`);
      const error = new InvalidHttpRouteResponseError(route.method, route.path, String(kind), problems.join('; '));
      this.scope.logger.error(error.message);
      throw FlowControl.fail(error);
    }
    return {
      kind: 'json',
      status: 200,
      body: result as Record<string, unknown>,
      contentType: 'application/json; charset=utf-8',
    };
  }

  /** The person signed in for routes of `auth`: a session for a subject opens `'subject'` routes only. */
  private async verifyPerson(auth: HttpRouteAuth): Promise<PeopleSession | undefined> {
    const cookie = getCookie(this.httpRequest.headers['cookie'], PEOPLE_SESSION_COOKIE);
    const person = await this.scope.httpRouteTable?.people?.findSession(cookie);
    return person && (person.subject !== undefined) === (auth === 'subject') ? person : undefined;
  }

  /** What keeps a stream open: the person's session, or until the bearer token expires. */
  private streamAuthorized(route: HttpRouteEntry): (() => boolean | Promise<boolean>) | undefined {
    if (route.auth === 'public') return undefined;
    if (route.auth !== 'bearer') return async () => (await this.verifyPerson(route.auth)) !== undefined;
    const expiresAt = this.state.caller?.expiresAt;
    return expiresAt === undefined ? undefined : () => Date.now() < expiresAt * 1000;
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
      authorized: this.streamAuthorized(route),
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

/** What a route's `authorities` read as input: the body's fields, then the path's parameters, which win. */
function authoritiesInput(request: ServerRequest): Record<string, unknown> {
  const { body } = request;
  const fields = typeof body === 'object' && body !== null && !Array.isArray(body) ? body : {};
  return { ...(fields as Record<string, unknown>), ...request.params };
}
