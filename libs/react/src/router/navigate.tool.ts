/**
 * NavigateTool — MCP tool that navigates to a URL path in the application.
 *
 * This is a plain class (not using SDK decorators) to avoid requiring
 * reflect-metadata in browser bundles. It exposes the same shape that
 * `create()` accepts in its `tools` array.
 */

import { getNavigate } from './router-bridge';

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

    navigate(args.path, { replace: args.replace });
    return {
      content: [{ type: 'text', text: `Navigated to ${args.path}` }],
    };
  }
}
