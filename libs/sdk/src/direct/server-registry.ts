/**
 * ServerRegistry — global singleton for named DirectMcpServer instances.
 *
 * Provides framework-agnostic server lifecycle management:
 * - Create and register servers by name
 * - Retrieve existing servers from anywhere in the app
 * - Dispose individual servers or all at once
 *
 * @example
 * ```typescript
 * import { ServerRegistry } from '@frontmcp/sdk';
 *
 * const server = await ServerRegistry.create('main', {
 *   info: { name: 'my-app', version: '1.0.0' },
 *   tools: [MyTool],
 * });
 *
 * // Later, from anywhere:
 * const same = ServerRegistry.get('main');
 * ```
 */

import type { DirectMcpServer } from './direct.types';
import type { CreateConfig } from './create.types';
import { create } from './create';

export class ServerRegistry {
  private static servers = new Map<string, DirectMcpServer>();

  /** Create and register a server. Returns existing if name is already registered. */
  static async create(name: string, config: CreateConfig): Promise<DirectMcpServer> {
    const existing = ServerRegistry.servers.get(name);
    if (existing) return existing;
    const server = await create(config);
    ServerRegistry.servers.set(name, server);
    return server;
  }

  /** Get a registered server by name. */
  static get(name: string): DirectMcpServer | undefined {
    return ServerRegistry.servers.get(name);
  }

  /** Check if a server is registered. */
  static has(name: string): boolean {
    return ServerRegistry.servers.has(name);
  }

  /** Dispose and unregister a server. */
  static async dispose(name: string): Promise<void> {
    const server = ServerRegistry.servers.get(name);
    if (server) {
      await server.dispose();
      ServerRegistry.servers.delete(name);
    }
  }

  /** Dispose all registered servers. */
  static async disposeAll(): Promise<void> {
    const promises = Array.from(ServerRegistry.servers.entries()).map(async ([name, server]) => {
      await server.dispose();
      ServerRegistry.servers.delete(name);
    });
    await Promise.all(promises);
  }

  /** List all registered server names. */
  static list(): string[] {
    return Array.from(ServerRegistry.servers.keys());
  }
}
