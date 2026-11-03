import { LoopbackTokenAuth, peopleAuthOptionsSchema } from '@frontmcp/auth';
import { ProviderScope } from '@frontmcp/di';

import {
  HTTP_ROUTE_PATH_MESSAGE,
  httpRouteMetadataOf,
  isHttpRoutePath,
  type HttpRouteAuth,
  type HttpRouteCtorArgs,
  type HttpRouteInterface,
  type HttpRouteMethod,
  type HttpRouteSseOptions,
  type ProviderRegistryInterface,
} from '../common';
import { questionInboxRoutes } from '../elicitation/questions/question-inbox.routes';
import { InvalidHttpRouteError, InvalidPeopleAuthOptionsError } from '../errors';
import { matchRoutePath } from '../flows/flow.http-path';
import { servedHealthPaths } from '../health/health.routes';
import type ProviderRegistry from '../provider/provider.registry';
import type { Scope } from '../scope/scope.instance';
import { assertNotReserved, computeReservedPaths } from '../server/custom-routes.helper';
import { PEOPLE_SIGN_IN_ROUTES } from './people-sign-in.routes';
import type { SseRouteStream } from './sse-route.stream';

export interface HttpRouteEntry {
  method: HttpRouteMethod;
  path: string;
  auth: HttpRouteAuth;
  sse?: Required<HttpRouteSseOptions>;
  target: new (args: HttpRouteCtorArgs) => HttpRouteInterface;
  providers: ProviderRegistryInterface;
  /** On the MCP endpoint's own path, where a GET asking for an event stream or naming a session stays the endpoint's. */
  sharesMcpPath: boolean;
}

export interface HttpRouteRequest {
  method: string;
  path: string;
  headers: Readonly<Record<string, string | string[] | undefined>>;
}

function header(request: HttpRouteRequest, name: string): string {
  const value = request.headers[name];
  return (Array.isArray(value) ? value.join(',') : value) ?? '';
}

function isMcpStreamRequest(request: HttpRouteRequest): boolean {
  return header(request, 'accept').includes('text/event-stream') || header(request, 'mcp-session-id') !== '';
}

/** A scope's `@HttpRoute`s, matched by method and path, and the SSE streams they hold open. */
export class HttpRouteTable {
  private readonly streams = new Set<SseRouteStream>();

  constructor(
    readonly routes: readonly HttpRouteEntry[],
    readonly people?: LoopbackTokenAuth,
  ) {}

  match(request: HttpRouteRequest): { route: HttpRouteEntry; params: Record<string, string> } | undefined {
    const method = request.method.toUpperCase();
    for (const route of this.routes) {
      if (route.method !== method) continue;
      const params = matchRoutePath(route.path, request.path);
      if (!params || (route.sharesMcpPath && isMcpStreamRequest(request))) continue;
      return { route, params };
    }
    return undefined;
  }

  track(stream: SseRouteStream): void {
    this.streams.add(stream);
  }

  untrack(stream: SseRouteStream): void {
    this.streams.delete(stream);
  }

  closeStreams(): void {
    for (const stream of [...this.streams]) stream.close();
  }
}

const peopleAuthByServer = new WeakMap<object, LoopbackTokenAuth>();

function printSignInToken(token: string): void {
  const message =
    `[frontmcp] people sign-in token: ${token}\n` +
    '[frontmcp] It is shown only once. Exchange it for a one-time sign-in link: ' +
    'POST /_frontmcp/people/code with "Authorization: Bearer <token>".\n';
  if (typeof process !== 'undefined' && typeof process.stderr?.write === 'function') process.stderr.write(message);
  else console.warn(message);
}

function peopleAuthFor(server: object, option: unknown, scopeProviders: ProviderRegistry): LoopbackTokenAuth {
  let auth = peopleAuthByServer.get(server);
  if (!auth) {
    const parsed = peopleAuthOptionsSchema().safeParse(option);
    if (!parsed.success) throw new InvalidPeopleAuthOptionsError(parsed.error.issues.map((issue) => issue.message));
    auth = new LoopbackTokenAuth(parsed.data);
    peopleAuthByServer.set(server, auth);
    const token = auth.takeToken();
    if (token) printSignInToken(token);
  }
  scopeProviders.injectProvider({
    provide: LoopbackTokenAuth,
    value: auth,
    metadata: {
      name: 'LoopbackTokenAuth',
      scope: ProviderScope.GLOBAL,
      description: 'People sign-in for @HttpRoute pages',
    },
  });
  return auth;
}

function withoutTrailingSlash(path: string): string {
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
}

/**
 * Give a scope the routes it serves: its apps' `@HttpRoute`s, plus the people sign-in routes when `http.auth.people`
 * is set (and the question inbox when `elicitation.persistent` is on too); none when it has neither. The scopes of one `server` share one people auth. Fails fast on a bad or duplicate path, a path of the MCP endpoint, a class that is
 * not an `@HttpRoute`, and a people route without people auth.
 */
export function attachHttpRoutes(scope: Scope, server: object): void {
  const declared = scope.apps.getApps().flatMap((app) => {
    const routes = (app.metadata as { routes?: readonly unknown[] }).routes ?? [];
    return routes.map((target) => ({ target, providers: app.providers }));
  });
  const peopleOption = scope.metadata.http?.auth?.people;
  const questions = scope.persistentQuestions;
  if (questions && peopleOption === undefined) {
    scope.logger.warn(
      'elicitation.persistent is on but http.auth.people is not set, so the question inbox is off: ' +
        "set http: { auth: { people: 'loopback-token' } } to answer questions at /_frontmcp/inbox or with frontmcp inbox",
    );
  }
  if (declared.length === 0 && peopleOption === undefined) return;

  const people = peopleOption === undefined ? undefined : peopleAuthFor(server, peopleOption, scope.providers);
  const builtInRoutes = [...PEOPLE_SIGN_IN_ROUTES, ...(questions ? questionInboxRoutes(questions.store) : [])];
  const builtIn = people ? builtInRoutes.map((target) => ({ target, providers: scope.providers })) : [];
  const reserved = computeReservedPaths(scope.entryPath, scope.routeBase, servedHealthPaths(scope.metadata.health));
  const mcpPath = scope.fullPath || '/';
  const served = new Set<string>();

  const routes = [...builtIn, ...declared].map(({ target, providers }): HttpRouteEntry => {
    const metadata = httpRouteMetadataOf(target);
    if (!metadata) {
      throw new InvalidHttpRouteError('?', String((target as { name?: string }).name), 'not an @HttpRoute class');
    }
    const { method } = metadata;
    const path = typeof metadata.path === 'function' ? metadata.path() : metadata.path;
    if (!isHttpRoutePath(path)) throw new InvalidHttpRouteError(method, String(path), HTTP_ROUTE_PATH_MESSAGE);
    const auth = metadata.auth ?? (people ? 'people' : 'public');
    if (auth !== 'public' && !people) {
      throw new InvalidHttpRouteError(
        method,
        path,
        "it needs a signed-in person, but http.auth.people is not set: set it, or give the route auth: 'public'",
      );
    }
    const sharesMcpPath = method === 'GET' && withoutTrailingSlash(path) === mcpPath;
    if (!sharesMcpPath) assertNotReserved(method, path, reserved);
    if (sharesMcpPath && metadata.sse) {
      throw new InvalidHttpRouteError(
        method,
        path,
        'an SSE route cannot be on the MCP path: an EventSource asks for text/event-stream, which the MCP endpoint serves there',
      );
    }
    const key = `${method} ${withoutTrailingSlash(path)}`;
    if (served.has(key)) {
      throw new InvalidHttpRouteError(method, path, 'another route already serves this method and path');
    }
    served.add(key);
    return {
      method,
      path,
      auth,
      sse: metadata.sse,
      target: target as HttpRouteEntry['target'],
      providers,
      sharesMcpPath,
    };
  });
  const table = new HttpRouteTable(routes, people);
  scope.httpRouteTable = table;
  scope.onDispose(() => table.closeStreams());
}
