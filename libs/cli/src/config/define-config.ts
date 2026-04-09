/**
 * defineConfig — Typed Helper
 *
 * Provides IDE autocomplete and type safety for `frontmcp.config.ts` files.
 *
 * @example
 * ```typescript
 * // frontmcp.config.ts
 * import { defineConfig } from '@frontmcp/cli';
 *
 * export default defineConfig({
 *   name: 'my-server',
 *   version: '1.0.0',
 *   deployments: [
 *     { target: 'distributed', ha: { heartbeatIntervalMs: 5000 } },
 *     { target: 'cli', cli: { description: 'My CLI' } },
 *   ],
 * });
 * ```
 */

import type { FrontMcpConfig } from './frontmcp-config.types';

/**
 * Define a FrontMCP configuration with full TypeScript type safety.
 * This is a pass-through function that provides IDE autocomplete.
 */
export function defineConfig(config: FrontMcpConfig): FrontMcpConfig {
  return config;
}
