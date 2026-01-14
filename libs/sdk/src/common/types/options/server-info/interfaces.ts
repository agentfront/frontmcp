// common/types/options/server-info/interfaces.ts
// Explicit TypeScript interfaces for server info configuration

import { Icon } from '@modelcontextprotocol/sdk/types.js';

/**
 * Server information configuration options.
 */
export interface ServerInfoOptionsInterface {
  /**
   * The name of the server.
   */
  name: string;

  /**
   * The display title of the server.
   */
  title?: string;

  /**
   * The version of the server.
   */
  version: string;

  /**
   * The website URL for the server.
   */
  websiteUrl?: string;

  /**
   * Icons for the server.
   */
  icons?: Icon[];
}
