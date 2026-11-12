/**
 * NavigateTool — MCP tool that navigates to a URL path in the application.
 *
 * This is a plain class (not using SDK decorators) to avoid requiring
 * reflect-metadata in browser bundles. It exposes the same shape that
 * `create()` accepts in its `tools` array.
 */

import { getNavigate } from './router-bridge';

/**
 * Whether `path` stays in this application: no backslash or control character, which the browser reads as a
 * separator or drops after the router has resolved the path, and, in a browser, no other origin once resolved.
 */
function isApplicationPath(path: string): boolean {
  if ([...path].some((char) => char === '\\' || char < ' ' || char === '\u007f')) return false;
  const location = (globalThis as { location?: { href: string; origin: string } }).location;
  if (!location) return true;
  try {
    return new URL(path, location.href).origin === location.origin;
  } catch {
    return false;
  }
}

export class NavigateTool {
  static readonly toolName = 'navigate';
  static readonly description = 'Navigate to a URL path in the application';
  static readonly inputSchema = {
    type: 'object' as const,
    properties: {
      path: { type: 'string', description: 'The URL path to navigate to' },
      replace: { type: 'boolean', description: 'Replace current history entry instead of pushing' },
    },
    required: ['path'] as const,
  };

  static async execute(args: {
    path: string;
    replace?: boolean;
  }): Promise<{ content: Array<{ type: string; text: string }> }> {
    const navigate = getNavigate();
    if (!navigate) {
      return {
        content: [
          {
            type: 'text',
            text: 'Router bridge not connected. Ensure useRouterBridge() is called inside a React Router tree.',
          },
        ],
      };
    }

    if (!isApplicationPath(args.path)) {
      return {
        content: [
          {
            type: 'text',
            text: `Not navigated to ${JSON.stringify(args.path)}: give a path in this application, without another origin, a backslash or a control character.`,
          },
        ],
      };
    }

    navigate(args.path, { replace: args.replace });
    return {
      content: [{ type: 'text', text: `Navigated to ${args.path}` }],
    };
  }
}
