import type { FrontMcpLogger, ServerRequest, ServerRequestHandler } from '../../common';
import { InvalidToolUiConfigError } from '../../errors/tool-ui.errors';
import { matchRoutePath } from '../../flows/flow.http-path';
import {
  computeReservedPaths,
  wrapWithIpFilter,
  type CheckClientIpFn,
  type HttpRouteRegistrar,
} from '../../server/custom-routes.helper';
import { widgetPageOf } from './ui-resource.handler';
import type { ToolUIRegistry } from './ui-shared';

/** A route the server already answers, which a widget path must not take. */
export interface TakenRoute {
  method: string;
  path: string;
  /** What serves it, for the startup message, e.g. "an http.routes entry". */
  owner: string;
}

export interface RegisterWidgetRoutesArgs {
  /** The `'direct-url'` widgets: each tool and the path its page is served on. */
  widgets: ReadonlyArray<{ toolName: string; path: string }>;
  registry: ToolUIRegistry;
  server: HttpRouteRegistrar;
  /** Runs `http:ip-filter` before every widget route, as for `http.routes`. */
  checkClientIp: CheckClientIpFn;
  entryPath: string;
  routeBase: string;
  healthPaths: readonly string[];
  /** The routes the scope already serves: `http.routes`, channel webhooks and `@HttpRoute`s. */
  takenRoutes: readonly TakenRoute[];
  /** The flow that answers a GET of `path` (OAuth, discovery, skills), if any. */
  flowFor: (request: ServerRequest) => Promise<string | undefined>;
  logger: FrontMcpLogger;
}

/** Paths below these belong to FrontMCP, whatever is mounted there today. */
const FRAMEWORK_PREFIXES = ['/_frontmcp'];

/** Express matches routes case-insensitively and ignores a trailing slash, so compare paths that way. */
function comparable(path: string): string {
  const lower = path.toLowerCase();
  return lower.length > 1 && lower.endsWith('/') ? lower.slice(0, -1) : lower;
}

function underPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

async function describeConflict(
  toolName: string,
  path: string,
  args: RegisterWidgetRoutesArgs,
  claimedBy: Map<string, string>,
): Promise<string | undefined> {
  const key = comparable(path);
  const conflict = (what: string) =>
    `Tool "${toolName}": its widget route GET ${path} collides with ${what}. Set a different \`ui.directPath\`.`;

  const earlier = claimedBy.get(key);
  if (earlier) return conflict(`the widget route of tool "${earlier}"`);

  const reserved = computeReservedPaths(args.entryPath, args.routeBase, args.healthPaths);
  if ([...reserved.exact].some((exact) => comparable(exact) === key)) return conflict('a FrontMCP endpoint');
  const prefix = [...reserved.prefixes, ...FRAMEWORK_PREFIXES].find((reservedPrefix) =>
    underPrefix(key, reservedPrefix.toLowerCase()),
  );
  if (prefix) return conflict(`FrontMCP's ${prefix} routes`);

  const route = args.takenRoutes.find(
    (taken) => taken.method.toUpperCase() === 'GET' && matchRoutePath(comparable(taken.path), key) !== undefined,
  );
  if (route) return conflict(`${route.owner} (GET ${route.path})`);

  const request = {
    method: 'GET',
    path,
    url: path,
    headers: { accept: 'text/html' },
    query: {},
  } as unknown as ServerRequest;
  const flow = await args.flowFor(request).catch(() => undefined);
  if (flow) return conflict(`the "${flow}" endpoint`);

  return undefined;
}

/**
 * The handler of a widget route: the tool's page compiled at startup, which holds no call's data,
 * framable by any host (`frame-ancestors *`, which browsers apply in place of `X-Frame-Options`).
 */
function widgetRouteHandler(registry: ToolUIRegistry, toolName: string): ServerRequestHandler {
  return (_request, response) => {
    response.status(200);
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.setHeader('Cache-Control', 'no-cache');
    response.setHeader('Content-Security-Policy', 'frame-ancestors *');
    response.removeHeader('X-Frame-Options');
    response.send(widgetPageOf(registry, toolName));
  };
}

/**
 * Serve each `'direct-url'` widget's page on its route, without auth: a host loads it in a frame,
 * which sends no credentials. Refuses to start when a path collides with a FrontMCP endpoint,
 * another route of the server or another widget.
 *
 * @throws {InvalidToolUiConfigError} One line per collision
 */
export async function registerWidgetRoutes(args: RegisterWidgetRoutesArgs): Promise<void> {
  const claimedBy = new Map<string, string>();
  const problems: string[] = [];
  for (const { toolName, path } of args.widgets) {
    const conflict = await describeConflict(toolName, path, args, claimedBy);
    if (conflict) problems.push(conflict);
    else claimedBy.set(comparable(path), toolName);
  }
  if (problems.length > 0) throw new InvalidToolUiConfigError(problems);

  for (const { toolName, path } of args.widgets) {
    args.server.registerRoute(
      'GET',
      path,
      wrapWithIpFilter(widgetRouteHandler(args.registry, toolName), args.checkClientIp),
    );
    args.logger.verbose(`Serving the widget of tool "${toolName}" on GET ${path}`);
  }
}
