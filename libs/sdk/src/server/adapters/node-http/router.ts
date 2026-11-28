// The routing of an Express app, for the path syntax the node:http host accepts (#948): literal segments and
// `:name` segments. It dispatches as Express 4's router does: case-insensitive, an optional trailing slash, a mount
// path stripped from `req.url` while its middleware runs, HEAD answered by a GET route, OPTIONS answered with the
// methods of the routes that match, a 4-argument handler for errors only, and a throwing handler passed to `next`.
import type * as http from 'node:http';

import { pathnameOf } from './request-url';

export type NextFunction = (err?: unknown) => void;
export type RequestHandler = (req: NativeRequest, res: NativeResponse, next: NextFunction) => unknown;
export type ErrorHandler = (err: unknown, req: NativeRequest, res: NativeResponse, next: NextFunction) => unknown;
export type Handler = RequestHandler | ErrorHandler;

/** The request fields the router and the host's middleware set, as Express sets them. */
export interface NativeRequest extends http.IncomingMessage {
  url: string;
  method: string;
  baseUrl?: string;
  originalUrl?: string;
  params?: Record<string, string>;
  route?: Route;
  next?: NextFunction;
  query?: unknown;
  body?: unknown;
  res?: NativeResponse;
  readonly path: string;
}

export interface NativeResponse extends http.ServerResponse {
  req: NativeRequest;
  locals?: Record<string, unknown>;
  status(code: number): NativeResponse;
  send(body?: unknown): NativeResponse;
  json(body?: unknown): NativeResponse;
  redirect(statusOrUrl: number | string, url?: string): void;
}

/** What the router needs from the host: how promises returned by handlers settle, and the OPTIONS answer. */
export interface RouterHooks {
  /** Express 5 sends a rejected handler promise to `next`; Express 4 leaves it unhandled. */
  catchRejections: boolean;
  /** Express 4 also ends a mount path at a `.` (`/a` mounted serves `/a.json`); Express 5 only at a `/`. */
  dotEndsMountPath: boolean;
  /** Writes the automatic OPTIONS response for the methods of the matching routes, in the order they were found. */
  sendOptions(res: NativeResponse, methods: string[]): void;
}

const PARAM_SEGMENT = /^:\w+$/;
const LITERAL_SEGMENT = /^[A-Za-z0-9_~.-]+$/;

/** Whether the node:http router matches `path` exactly as Express does: literal and `:name` segments only. */
export function isSupportedPath(path: string): boolean {
  if (path === '' || path === '/') return true;
  if (!path.startsWith('/')) return false;
  const segments = path.slice(1).split('/');
  // A trailing slash leaves an empty last segment
  if (segments[segments.length - 1] === '') segments.pop();
  return (
    segments.length > 0 && segments.every((segment) => PARAM_SEGMENT.test(segment) || LITERAL_SEGMENT.test(segment))
  );
}

/** The regular expression path-to-regexp 0.1 builds for a supported path (non-strict, case-insensitive). */
function compilePath(path: string, end: boolean): { regexp: RegExp; keys: string[] } {
  const keys: string[] = [];
  let source = path.replace(/\/:(\w+)|\./g, (match, key: string | undefined) => {
    if (match === '.') return '\\.';
    keys.push(key as string);
    return '(?:/([^/]+?))';
  });
  source += source[source.length - 1] === '/' ? '?' : '/?';
  if (end) source += '$';
  else if (source[source.length - 1] !== '/') source += '(?=/|$)';
  return { regexp: new RegExp(`^${source}`, 'i'), keys };
}

function decodeParam(value: string | undefined): string | undefined {
  if (typeof value !== 'string' || value.length === 0) return value;
  try {
    return decodeURIComponent(value);
  } catch (error) {
    if (error instanceof URIError) {
      error.message = `Failed to decode param '${value}'`;
      Object.assign(error, { status: 400, statusCode: 400 });
    }
    throw error;
  }
}

class Layer {
  readonly regexp: RegExp;
  readonly keys: string[];
  private readonly fastSlash: boolean;
  route?: Route;

  constructor(
    path: string,
    end: boolean,
    readonly handle: Handler,
    private readonly hooks: RouterHooks,
  ) {
    ({ regexp: this.regexp, keys: this.keys } = compilePath(path, end));
    this.fastSlash = path === '/' && !end;
  }

  /** The matched path and parameters, or `undefined` when the layer does not match; throws on a malformed param. */
  match(path: string): { path: string; params: Record<string, string> } | undefined {
    if (this.fastSlash) return { path: '', params: {} };
    const match = this.regexp.exec(path);
    if (!match) return undefined;
    const params: Record<string, string> = {};
    for (let i = 1; i < match.length; i++) {
      const name = this.keys[i - 1];
      const value = decodeParam(match[i]);
      if (value !== undefined || !Object.prototype.hasOwnProperty.call(params, name)) {
        params[name] = value as string;
      }
    }
    return { path: match[0], params };
  }

  handleError(error: unknown, req: NativeRequest, res: NativeResponse, next: NextFunction): void {
    const fn = this.handle;
    if (fn.length !== 4) {
      next(error);
      return;
    }
    try {
      this.settle((fn as ErrorHandler)(error, req, res, next), next);
    } catch (thrown) {
      next(thrown);
    }
  }

  handleRequest(req: NativeRequest, res: NativeResponse, next: NextFunction): void {
    const fn = this.handle;
    if (fn.length > 3) {
      next();
      return;
    }
    try {
      this.settle((fn as RequestHandler)(req, res, next), next);
    } catch (thrown) {
      next(thrown);
    }
  }

  private settle(result: unknown, next: NextFunction): void {
    if (!this.hooks.catchRejections) return;
    if (result !== null && typeof result === 'object' && typeof (result as Promise<unknown>).then === 'function') {
      (result as Promise<unknown>).then(undefined, (error: unknown) => next(error || new Error('Rejected promise')));
    }
  }
}

export class Route {
  private readonly stack: { method: string; layer: Layer }[] = [];
  private readonly methods: Record<string, boolean> = {};

  constructor(private readonly hooks: RouterHooks) {}

  add(method: string, handler: RequestHandler): void {
    const name = method.toLowerCase();
    this.methods[name] = true;
    this.stack.push({ method: name, layer: new Layer('/', false, handler, this.hooks) });
  }

  handlesMethod(method: string): boolean {
    let name = method.toLowerCase();
    if (name === 'head' && !this.methods['head']) name = 'get';
    return Boolean(this.methods[name]);
  }

  options(): string[] {
    const methods = Object.keys(this.methods);
    if (this.methods['get'] && !this.methods['head']) methods.push('head');
    return methods.map((method) => method.toUpperCase());
  }

  dispatch(req: NativeRequest, res: NativeResponse, done: NextFunction): void {
    let idx = 0;
    let sync = 0;
    if (this.stack.length === 0) {
      done();
      return;
    }
    let method = req.method.toLowerCase();
    if (method === 'head' && !this.methods['head']) method = 'get';
    req.route = this;
    const next: NextFunction = (err) => {
      if (err && err === 'route') return done();
      if (err && err === 'router') return done(err);
      if (++sync > 100) {
        setImmediate(next, err);
        return;
      }
      const entry = this.stack[idx++];
      if (!entry) return done(err);
      if (entry.method && entry.method !== method) next(err);
      else if (err) entry.layer.handleError(err, req, res, next);
      else entry.layer.handleRequest(req, res, next);
      sync = 0;
    };
    next();
  }
}

/** The host's routing table: an Express app's stack, or the router the app mounts at `/`. */
export class Router {
  private readonly stack: Layer[] = [];

  constructor(private readonly hooks: RouterHooks) {}

  use(path: string, handler: Handler): void {
    this.stack.push(new Layer(path, false, handler, this.hooks));
  }

  route(method: string, path: string, handler: RequestHandler): void {
    const route = new Route(this.hooks);
    const layer = new Layer(
      path,
      true,
      (req: NativeRequest, res: NativeResponse, next: NextFunction) => route.dispatch(req, res, next),
      this.hooks,
    );
    layer.route = route;
    route.add(method, handler);
    this.stack.push(layer);
  }

  /** As a handler of another router (`app.use('/', router)`). */
  readonly asHandler = (req: NativeRequest, res: NativeResponse, next: NextFunction): void => {
    this.handle(req, res, next);
  };

  handle(req: NativeRequest, res: NativeResponse, out: NextFunction): void {
    const hooks = this.hooks;
    let idx = 0;
    const protohost = getProtohost(req.url) || '';
    let removed = '';
    let slashAdded = false;
    let sync = 0;
    const options: string[] = [];
    const stack = this.stack;
    const parentUrl = req.baseUrl || '';
    let done = restore(out, req, 'baseUrl', 'next', 'params');

    req.next = next;

    if (req.method === 'OPTIONS') {
      const old = done;
      done = (err) => {
        if (err || options.length === 0) return old(err);
        try {
          hooks.sendOptions(res, options);
        } catch (error) {
          old(error);
        }
      };
    }

    req.baseUrl = parentUrl;
    req.originalUrl = req.originalUrl || req.url;

    next();

    function next(err?: unknown): void {
      let layerError = err === 'route' ? null : err;

      if (slashAdded) {
        req.url = req.url.slice(1);
        slashAdded = false;
      }

      if (removed.length !== 0) {
        req.baseUrl = parentUrl;
        req.url = protohost + removed + req.url.slice(protohost.length);
        removed = '';
      }

      if (layerError === 'router') {
        setImmediate(done, null);
        return;
      }

      if (idx >= stack.length) {
        setImmediate(done, layerError);
        return;
      }

      if (++sync > 100) {
        setImmediate(next, err);
        return;
      }

      let path: string | null | undefined;
      try {
        path = pathnameOf(req);
      } catch {
        path = undefined;
      }
      if (path == null) {
        done(layerError);
        return;
      }

      let layer: Layer | undefined;
      let matched: { path: string; params: Record<string, string> } | undefined;
      let route: Route | undefined;
      // true, false, or the error a malformed parameter raised (Express's matchLayer)
      let match: unknown = false;

      while (match !== true && idx < stack.length) {
        layer = stack[idx++];
        try {
          matched = layer.match(path);
          match = matched !== undefined;
        } catch (error) {
          matched = undefined;
          match = error;
        }
        route = layer.route;

        if (typeof match !== 'boolean') layerError = layerError || match;
        if (match !== true) continue;
        if (!route) continue;
        if (layerError) {
          match = false;
          continue;
        }

        const method = req.method;
        const hasMethod = route.handlesMethod(method);
        if (!hasMethod && method === 'OPTIONS') options.push(...route.options());
        if (!hasMethod && method !== 'HEAD') match = false;
      }

      if (match !== true || !layer || !matched) {
        done(layerError);
        return;
      }

      if (route) req.route = route;
      req.params = matched.params;
      const layerPath = matched.path;
      const current = layer;

      if (route) current.handleRequest(req, res, next);
      else trimPrefix(current, layerError, layerPath, path);
      sync = 0;
    }

    function trimPrefix(layer: Layer, layerError: unknown, layerPath: string, path: string): void {
      if (layerPath.length !== 0) {
        if (layerPath !== path.slice(0, layerPath.length)) {
          next(layerError);
          return;
        }
        const c = path[layerPath.length];
        if (c && c !== '/' && (c !== '.' || !hooks.dotEndsMountPath)) {
          next(layerError);
          return;
        }
        removed = layerPath;
        req.url = protohost + req.url.slice(protohost.length + removed.length);
        if (!protohost && req.url[0] !== '/') {
          req.url = '/' + req.url;
          slashAdded = true;
        }
        req.baseUrl =
          parentUrl + (removed[removed.length - 1] === '/' ? removed.substring(0, removed.length - 1) : removed);
      }

      if (layerError) layer.handleError(layerError, req, res, next);
      else layer.handleRequest(req, res, next);
    }
  }
}

function getProtohost(url: string): string | undefined {
  if (typeof url !== 'string' || url.length === 0 || url[0] === '/') return undefined;
  const searchIndex = url.indexOf('?');
  const pathLength = searchIndex !== -1 ? searchIndex : url.length;
  const fqdnIndex = url.slice(0, pathLength).indexOf('://');
  return fqdnIndex !== -1 ? url.substring(0, url.indexOf('/', 3 + fqdnIndex)) : undefined;
}

/** Calls `fn` with the request's `props` put back to what they were when `restore` was called. */
function restore(fn: NextFunction, req: NativeRequest, ...props: ('baseUrl' | 'next' | 'params')[]): NextFunction {
  const values = props.map((prop) => req[prop]);
  return (err) => {
    props.forEach((prop, i) => {
      (req as unknown as Record<string, unknown>)[prop] = values[i];
    });
    return fn(err);
  };
}
