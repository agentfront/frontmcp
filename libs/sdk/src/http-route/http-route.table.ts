import { LoopbackTokenAuth, peopleAuthOptionsSchema, type PeopleAuthOption } from '@frontmcp/auth';
import { ProviderScope } from '@frontmcp/di';

import {
  HTTP_ROUTE_PATH_MESSAGE,
  httpRouteMetadataOf,
  isHttpRoutePath,
  normalizeEntryPrefix,
  normalizeScopeBase,
  type HttpRouteAuth,
  type HttpRouteCtorArgs,
  type HttpRouteInterface,
  type HttpRouteMethod,
  type HttpRouteSseOptions,
  type ProviderRegistryInterface,
} from '../common';
import { InvalidHttpRouteError } from '../errors';
import { matchRoutePath } from '../flows/flow.http-path';
import type ProviderRegistry from '../provider/provider.registry';
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

export interface BuildHttpRouteTableArgs {
  apps: ReadonlyArray<{ routes?: readonly unknown[]; providers: ProviderRegistryInterface }>;
  /** Gets the people auth as a provider, for the sign-in routes and for tools that hand out sign-in codes. */
  scopeProviders: ProviderRegistry;
  /** One people auth per server, whichever of its scopes builds it first. */
  server: object;
  people?: PeopleAuthOption;
  entryPath: string;
  routeBase: string;
  healthPaths?: readonly string[];
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

function peopleAuthFor(server: object, option: PeopleAuthOption, scopeProviders: ProviderRegistry): LoopbackTokenAuth {
  let auth = peopleAuthByServer.get(server);
  if (!auth) {
    auth = new LoopbackTokenAuth(peopleAuthOptionsSchema.parse(option));
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
 * The routes a scope serves: its apps' `@HttpRoute`s, plus the people sign-in routes when `http.auth.people` is set.
 * Returns `undefined` when there are none. Fails fast on a bad or duplicate path, a path of the MCP endpoint, and a
 * people route without people auth.
 */
export function buildHttpRouteTable(args: BuildHttpRouteTableArgs): HttpRouteTable | undefined {
  const declared = args.apps.flatMap((app) =>
    (app.routes ?? []).map((target) => ({ target, providers: app.providers })),
  );
  if (declared.length === 0 && !args.people) return undefined;

  const people = args.people ? peopleAuthFor(args.server, args.people, args.scopeProviders) : undefined;
  const builtIn = people ? PEOPLE_SIGN_IN_ROUTES.map((target) => ({ target, providers: args.scopeProviders })) : [];
  const reserved = computeReservedPaths(args.entryPath, args.routeBase, args.healthPaths);
  const mcpPath = `${normalizeEntryPrefix(args.entryPath)}${normalizeScopeBase(args.routeBase)}` || '/';
  const served = new Set<string>();

  const routes = [...builtIn, ...declared].map(({ target, providers }): HttpRouteEntry => {
    const metadata = httpRouteMetadataOf(target);
    if (!metadata)
      throw new InvalidHttpRouteError('?', String((target as { name?: string }).name), 'not an @HttpRoute class');
    const { method } = metadata;
    const path = typeof metadata.path === 'function' ? metadata.path() : metadata.path;
    if (!isHttpRoutePath(path)) throw new InvalidHttpRouteError(method, String(path), HTTP_ROUTE_PATH_MESSAGE);
    const auth = metadata.auth ?? (people ? 'people' : 'public');
    if (auth === 'people' && !people) {
      throw new InvalidHttpRouteError(
        method,
        path,
        "it needs a signed-in person, but http.auth.people is not set: set it, or give the route auth: 'public'",
      );
    }
    const sharesMcpPath = method === 'GET' && withoutTrailingSlash(path) === mcpPath;
    if (!sharesMcpPath) assertNotReserved(method, path, reserved);
    const key = `${method} ${withoutTrailingSlash(path)}`;
    if (served.has(key))
      throw new InvalidHttpRouteError(method, path, 'another route already serves this method and path');
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
  return new HttpRouteTable(routes, people);
}
