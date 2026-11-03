export type HttpRouteMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * Who may call a route: a signed-in person (`http.auth.people`), a person signed in for an MCP subject (with a code
 * from `createCode({ subject })`, such as the question inbox's), or anyone. Each kind of sign-in opens only its own
 * routes, so a code made for one caller's questions opens no `'people'` page.
 */
export type HttpRouteAuth = 'people' | 'subject' | 'public';

/** Where an SSE route hears that its view changed: a `resourceStore()`, whose keys publish their name as a topic. */
export interface HttpRouteTopicSource {
  subscribe(topic: string, listener: () => void): () => void;
}

export interface HttpRouteSseOptions {
  store: HttpRouteTopicSource;
  /** A publish on any of these sends a new view (`handle()`'s return value). */
  topics: readonly string[];
  /** Publishes within this window send one view, in milliseconds. @default 50 */
  coalesceMs?: number;
  /** A keep-alive comment is sent after this long without a view, in milliseconds. @default 15000 */
  heartbeatMs?: number;
}

export interface HttpRouteMetadata {
  method: HttpRouteMethod;
  /**
   * The path: literal segments and `:name` parameters (`/board/:id`), or a function that returns it when the server
   * starts, for a path that comes from options. The MCP endpoint's paths are refused, except a `GET` on its own path: a page load there
   * reaches the route, and the MCP event stream stays the endpoint's.
   */
  path: string | (() => string);
  /** @default 'people' when `http.auth.people` is set, else 'public' */
  auth?: HttpRouteAuth;
  /** Serve `text/event-stream`: `handle()` makes the view, sent at once and after each burst of publishes. */
  sse?: HttpRouteSseOptions;
}

export interface ResolvedHttpRouteMetadata {
  method: HttpRouteMethod;
  path: string | (() => string);
  auth?: HttpRouteAuth;
  sse?: Required<HttpRouteSseOptions>;
}

/** Literal segments and `:name` parameters: what the route table matches. */
const ROUTE_PATH = /^\/[^?#\s*(){}]*$/;
export const HTTP_ROUTE_PATH_MESSAGE =
  'path must start with "/" and hold no query, fragment or whitespace; it takes literal segments and :name ' +
  'parameters, not the wildcards or groups (*, (), {}) of Express';

export function isHttpRoutePath(path: unknown): path is string {
  return typeof path === 'string' && ROUTE_PATH.test(path);
}

const HTTP_ROUTE_METADATA = Symbol.for('frontmcp:http-route');

/** @internal Records what `@HttpRoute` resolved on the class. */
export function defineHttpRouteMetadata(target: object, metadata: ResolvedHttpRouteMetadata): void {
  Reflect.defineMetadata(HTTP_ROUTE_METADATA, metadata, target);
}

/** The `@HttpRoute` metadata of a class, when it has some. */
export function httpRouteMetadataOf(target: unknown): ResolvedHttpRouteMetadata | undefined {
  if (typeof target !== 'function') return undefined;
  return Reflect.getMetadata(HTTP_ROUTE_METADATA, target);
}
