/**
 * CurrentRouteResource — MCP resource that reads the current URL/path/params.
 */

import { getLocation } from './router-bridge';

export class CurrentRouteResource {
  static readonly uri = 'route://current';
  static readonly resourceName = 'Current Route';
  static readonly description = 'Read the current URL path, search params, and hash';

  static read(): { contents: Array<{ uri: string; mimeType: string; text: string }> } {
    const location = getLocation();
    if (!location) {
      return {
        contents: [
          {
            uri: 'route://current',
            mimeType: 'application/json',
            text: JSON.stringify({
              error: 'Router bridge not connected. Ensure useRouterBridge() is called inside a React Router tree.',
            }),
          },
        ],
      };
    }

    return {
      contents: [
        {
          uri: 'route://current',
          mimeType: 'application/json',
          text: JSON.stringify({
            pathname: location.pathname,
            search: location.search,
            hash: location.hash,
            href: `${location.pathname}${location.search}${location.hash}`,
          }),
        },
      ],
    };
  }
}
