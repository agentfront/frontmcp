import { z } from '@frontmcp/lazy-zod';

export type HttpRouteMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** Who may call a route: a signed-in person (`http.auth.people`), or anyone. */
export type HttpRouteAuth = 'people' | 'public';

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
   * The path, Express style (`/board/:id`), or a function that returns it when the server starts, for a path that
   * comes from options. The MCP endpoint's paths are refused, except a `GET` on its own path: a page load there
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

const ROUTE_PATH = /^\/[^?#\s]*$/;
export const HTTP_ROUTE_PATH_MESSAGE = 'path must start with "/" and hold no query, fragment or whitespace';

export function isHttpRoutePath(path: unknown): path is string {
  return typeof path === 'string' && ROUTE_PATH.test(path);
}

export const httpRouteMetadataSchema = z
  .object({
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], {
      message: "method must be 'GET', 'POST', 'PUT', 'PATCH' or 'DELETE'",
    }),
    path: z.custom<string | (() => string)>((value) => typeof value === 'function' || isHttpRoutePath(value), {
      message: HTTP_ROUTE_PATH_MESSAGE,
    }),
    auth: z.enum(['people', 'public'], { message: "auth must be 'people' or 'public'" }).optional(),
    sse: z
      .object({
        store: z.custom<HttpRouteTopicSource>(
          (value) => typeof (value as Partial<HttpRouteTopicSource> | null)?.subscribe === 'function',
          { message: 'sse.store must have subscribe(topic, listener), such as a resourceStore()' },
        ),
        topics: z
          .array(z.string().min(1, 'a topic must not be empty'))
          .min(1, 'sse.topics must name at least one topic'),
        coalesceMs: z.number().int().nonnegative('sse.coalesceMs must not be negative').default(50),
        heartbeatMs: z.number().int().positive('sse.heartbeatMs must be greater than 0').default(15_000),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine((metadata) => !metadata.sse || metadata.method === 'GET', {
    message: 'an sse route must use method GET',
    path: ['sse'],
  });

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
