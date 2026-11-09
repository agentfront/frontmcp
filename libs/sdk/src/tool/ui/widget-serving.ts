import type { WidgetServingMode } from '../../common';

/** Where a URL-served widget's page comes from (`servingMode: 'direct-url'`). */
export interface WidgetUrlSource {
  servingMode: 'direct-url';
  /** The server's route that serves the page, from its root, e.g. `/widgets/weather`. */
  path: string;
}

const MAX_WIDGET_PATH_LENGTH = 512;
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

  return problems;
}
