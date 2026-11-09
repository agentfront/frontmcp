import type { WidgetServingMode } from '../../common';
import { BUILT_ONCE_SERVING_MODES } from './serving-mode-default';

/** Where a URL-served widget's page comes from: a route of the server, or a URL such as a CDN's. */
export type WidgetUrlSource =
  | {
      servingMode: 'direct-url';
      /** The server's route that serves the page, from its root, e.g. `/widgets/weather`. */
      path: string;
    }
  | {
      servingMode: 'custom-url';
      /** The absolute URL of the page, e.g. `https://cdn.example.com/widgets/weather.html`. */
      url: string;
    };

const MAX_WIDGET_PATH_LENGTH = 512;
const MAX_WIDGET_URL_LENGTH = 2048;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const WIDGET_PATH_SEGMENT = /^[A-Za-z0-9._~-]+$/;

/**
 * The route a `'direct-url'` widget is served from when its tool sets no `ui.directPath`:
 * `/widgets/` and the tool name, each character other than a letter, digit, `.`, `_`, `~`
 * or `-` replaced with `-`.
 */
export function defaultWidgetPath(toolName: string): string {
  const segments = toolName.split('/').map((segment) => segment.replace(/[^A-Za-z0-9._~-]/g, '-') || '-');
  return `/widgets/${segments.join('/')}`;
}

/** Why `path` cannot be a widget route, or `undefined` when it can. */
function describeInvalidWidgetPath(path: unknown): string | undefined {
  if (typeof path !== 'string') return 'is not a string';
  if (path.length > MAX_WIDGET_PATH_LENGTH) return `is longer than ${MAX_WIDGET_PATH_LENGTH} characters`;
  if (!path.startsWith('/') || path === '/') return 'must start with "/" and name a path below the root';
  const segments = path.slice(1).split('/');
  const valid = segments.every((segment) => WIDGET_PATH_SEGMENT.test(segment) && !/^\.+$/.test(segment));
  return valid
    ? undefined
    : 'may hold only letters, digits, ".", "_", "~", "-" and "/" between non-empty segments, without "." or ".." segments';
}

/** Why `url` cannot be a `customWidgetUrl`, or `undefined` when it can. */
function describeInvalidWidgetUrl(url: unknown): string | undefined {
  if (typeof url !== 'string') return 'is not a string';
  if (url.length > MAX_WIDGET_URL_LENGTH) return `is longer than ${MAX_WIDGET_URL_LENGTH} characters`;
  if (/[{}]/.test(url)) {
    return (
      'has a `{…}` placeholder, which FrontMCP does not fill: a widget URL carries no token or call data, ' +
      'and the page gets each call’s result from the host'
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'is not an absolute URL';
  }
  const local = parsed.protocol === 'http:' && LOOPBACK_HOSTS.has(parsed.hostname);
  if (parsed.protocol !== 'https:' && !local) return 'must be an https:// URL (or http:// on localhost)';
  if (parsed.username || parsed.password) return 'must not hold credentials';
  return undefined;
}

/**
 * The route a tool's `'direct-url'` widget is served from: its `ui.directPath`, else
 * {@link defaultWidgetPath}. A trailing `/` is dropped.
 */
export function widgetPathOf(toolName: string, ui: Record<string, unknown>): string {
  const directPath = ui['directPath'];
  return typeof directPath === 'string' ? withoutTrailingSlash(directPath) : defaultWidgetPath(toolName);
}

function withoutTrailingSlash(path: string): string {
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
}

/**
 * The problems that stop a tool's `ui` serving options from working, one message per problem.
 * Startup refuses a config with any.
 *
 * @param toolName - The tool's name
 * @param ui - The tool's `ui` config
 * @param servingMode - The serving mode the tool resolved to (its own, its app's or the server's)
 */
export function describeWidgetServingProblems(
  toolName: string,
  ui: Record<string, unknown>,
  servingMode: WidgetServingMode,
): string[] {
  const problems: string[] = [];
  const directPath = ui['directPath'];

  if (directPath !== undefined) {
    if (servingMode !== 'direct-url') {
      problems.push(
        `Tool "${toolName}": \`ui.directPath\` is set, but the widget is served '${servingMode}', so nothing serves that path. ` +
          `Set \`ui.servingMode: 'direct-url'\`, or remove \`ui.directPath\`.`,
      );
    } else {
      const invalid = describeInvalidWidgetPath(
        typeof directPath === 'string' ? withoutTrailingSlash(directPath) : directPath,
      );
      if (invalid) problems.push(`Tool "${toolName}": \`ui.directPath\` ${JSON.stringify(directPath)} ${invalid}.`);
    }
  }

  problems.push(...describeBundlingModeProblems(toolName, ui));

  const customWidgetUrl = ui['customWidgetUrl'];
  if (servingMode === 'custom-url' && customWidgetUrl === undefined) {
    problems.push(
      `Tool "${toolName}": \`ui.servingMode: 'custom-url'\` needs \`ui.customWidgetUrl\`, the URL of the widget page.`,
    );
  } else if (customWidgetUrl !== undefined && servingMode !== 'custom-url') {
    problems.push(
      `Tool "${toolName}": \`ui.customWidgetUrl\` is set, but the widget is served '${servingMode}', so nothing loads that URL. ` +
        `Set \`ui.servingMode: 'custom-url'\`, or remove \`ui.customWidgetUrl\`.`,
    );
  } else if (customWidgetUrl !== undefined) {
    const invalid = describeInvalidWidgetUrl(customWidgetUrl);
    // The URL is not repeated: it may hold a credential or a key
    if (invalid) problems.push(`Tool "${toolName}": \`ui.customWidgetUrl\` ${invalid}.`);
  }

  return problems;
}

/**
 * A `ui.bundlingMode` that isn't `'static'` or `'dynamic'`, or that contradicts the tool's own
 * `ui.servingMode`: `'dynamic'` renders the page for each call, which only `'inline'` does, and
 * `'static'` builds it once, which `'inline'` doesn't.
 */
function describeBundlingModeProblems(toolName: string, ui: Record<string, unknown>): string[] {
  const bundlingMode = ui['bundlingMode'];
  if (bundlingMode === undefined) return [];
  if (bundlingMode !== 'static' && bundlingMode !== 'dynamic') {
    return [`Tool "${toolName}": \`ui.bundlingMode\` is ${JSON.stringify(bundlingMode)}; use 'static' or 'dynamic'.`];
  }
  const servingMode = ui['servingMode'];
  const contradicts =
    bundlingMode === 'dynamic'
      ? (BUILT_ONCE_SERVING_MODES as readonly unknown[]).includes(servingMode)
      : servingMode === 'inline';
  if (!contradicts) return [];
  const what =
    bundlingMode === 'dynamic'
      ? `\`ui.bundlingMode: 'dynamic'\` renders the page for each call, but \`ui.servingMode: '${String(servingMode)}'\` builds it once`
      : "`ui.bundlingMode: 'static'` builds the page once, at startup, but `ui.servingMode: 'inline'` renders it for each call";
  return [
    `Tool "${toolName}": ${what}. Remove one, or make them agree: 'dynamic' goes with 'inline', ` +
      "and 'static' with 'static', 'hybrid', 'direct-url' or 'custom-url'.",
  ];
}

/**
 * Where a tool's widget page loads from when it is served from a URL, or `undefined` for the other
 * modes. Reads a config {@link describeWidgetServingProblems} accepted.
 */
export function widgetUrlSourceOf(
  toolName: string,
  ui: Record<string, unknown>,
  servingMode: WidgetServingMode,
): WidgetUrlSource | undefined {
  if (servingMode === 'direct-url') return { servingMode, path: widgetPathOf(toolName, ui) };
  if (servingMode === 'custom-url') return { servingMode, url: String(ui['customWidgetUrl']) };
  return undefined;
}
