/**
 * GoBackTool — MCP tool that goes back to the previous page in history.
 */

import { getNavigate } from './router-bridge';

export class GoBackTool {
  static readonly toolName = 'go_back';
  static readonly description = 'Go back to the previous page in browser history';
  static readonly inputSchema = {
    type: 'object' as const,
    properties: {},
  };

  static async execute(): Promise<{ content: Array<{ type: string; text: string }> }> {
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

    navigate(-1);
    return {
      content: [{ type: 'text', text: 'Navigated back' }],
    };
  }
}
