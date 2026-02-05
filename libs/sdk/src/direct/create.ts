/**
 * `create()` Factory Function
 *
 * Spins up a FrontMCP direct server from a flat config object — no decorators,
 * no App classes, no HTTP server. Supports machineId injection for session
 * continuity and caching for reuse.
 *
 * @example
 * ```typescript
 * import { create } from '@frontmcp/sdk';
 *
 * const server = await create({
 *   info: { name: 'my-service', version: '1.0.0' },
 *   tools: [MyTool],
 *   adapters: [OpenapiAdapter.init({ name: 'api', spec, baseUrl })],
 * });
 *
 * const { tools } = await server.listTools();
 * const result = await server.callTool('my-tool', { arg: 'value' });
 * await server.dispose();
 * ```
 */

import 'reflect-metadata';

import type { FrontMcpConfigInput } from '../common';
import { FrontMcpLocalAppTokens } from '../common/tokens';
import type { DirectMcpServer } from './direct.types';
import type { CreateConfig } from './create.types';

// ─────────────────────────────────────────────────────────────────────────────
// Instance cache (keyed by cacheKey)
// ─────────────────────────────────────────────────────────────────────────────

let instanceCache = new Map<string, Promise<DirectMcpServer>>();

// ─────────────────────────────────────────────────────────────────────────────
// Config builder
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert a flat `CreateConfig` into a `FrontMcpConfigInput` with a synthetic app.
 * @internal Exported for testing.
 */
export function buildConfig(config: CreateConfig): FrontMcpConfigInput {
  const appName = config.appName ?? config.info.name;

  // Synthetic app class that carries the app-level entries.
  // Replicates what @App() decorator does: sets per-property metadata tokens.
  const syntheticApp = class SyntheticApp {};
  Object.defineProperty(syntheticApp, 'name', { value: appName });

  // Mark as a valid app (required by annotatedFrontMcpAppSchema)
  Reflect.defineMetadata(FrontMcpLocalAppTokens.type, true, syntheticApp);

  // Set individual metadata tokens (same as @App() decorator)
  const appMeta: Record<string, unknown> = {
    name: appName,
    tools: config.tools,
    resources: config.resources,
    prompts: config.prompts,
    adapters: config.adapters,
    plugins: config.plugins,
    providers: config.providers,
    authProviders: config.authProviders,
    agents: config.agents,
    skills: config.skills,
    auth: config.auth,
  };

  for (const key of Object.keys(appMeta)) {
    if (appMeta[key] !== undefined) {
      const token = FrontMcpLocalAppTokens[key as keyof typeof FrontMcpLocalAppTokens] ?? key;
      Reflect.defineMetadata(token, appMeta[key], syntheticApp);
    }
  }

  return {
    info: config.info,
    apps: [syntheticApp],
    serve: false,
    redis: config.redis,
    pubsub: config.pubsub,
    transport: config.transport,
    logging: config.logging,
    pagination: config.pagination,
    elicitation: config.elicitation,
    skillsConfig: config.skillsConfig,
    extApps: config.extApps,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory function
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a FrontMCP direct server from a flat config object.
 *
 * Returns a `DirectMcpServer` that provides `listTools`, `callTool`,
 * `listResources`, `readResource`, `listPrompts`, `getPrompt`, and `dispose`.
 *
 * @param config - Flat configuration combining server and app fields
 * @returns A ready-to-use `DirectMcpServer`
 *
 * @example Basic usage
 * ```typescript
 * const server = await create({
 *   info: { name: 'my-service', version: '1.0.0' },
 *   tools: [MyTool],
 * });
 * const { tools } = await server.listTools();
 * await server.dispose();
 * ```
 *
 * @example With caching and machineId
 * ```typescript
 * const server = await create({
 *   info: { name: 'my-service', version: '1.0.0' },
 *   tools: [MyTool],
 *   machineId: 'stable-id-for-sessions',
 *   cacheKey: 'tenant-123',
 * });
 * ```
 */
export async function create(config: CreateConfig): Promise<DirectMcpServer> {
  const { cacheKey } = config;

  // Check cache first
  if (cacheKey) {
    const cached = instanceCache.get(cacheKey);
    if (cached) {
      return cached;
    }
  }

  const serverPromise = (async (): Promise<DirectMcpServer> => {
    try {
      // Apply machine ID override if provided
      if (config.machineId !== undefined) {
        const { setMachineIdOverride } = await import('../auth/machine-id.js');
        setMachineIdOverride(config.machineId);
      }

      // Build full config and create direct server
      const fullConfig = buildConfig(config);
      const { FrontMcpInstance } = await import('../front-mcp/front-mcp.js');
      const server = await FrontMcpInstance.createDirect(fullConfig);

      // Wrap dispose to auto-evict from cache
      if (cacheKey) {
        const originalDispose = server.dispose.bind(server);
        server.dispose = async () => {
          instanceCache.delete(cacheKey);
          return originalDispose();
        };
      }

      return server;
    } catch (error) {
      // Evict failed init from cache
      if (cacheKey) {
        instanceCache.delete(cacheKey);
      }
      throw error;
    }
  })();

  // Store in cache before awaiting (so concurrent calls get the same promise)
  if (cacheKey) {
    instanceCache.set(cacheKey, serverPromise);
  }

  return serverPromise;
}

/**
 * Clear the create() instance cache.
 * Useful for testing to ensure clean state between test runs.
 * Does NOT dispose cached servers — call `dispose()` on each first.
 */
export function clearCreateCache(): void {
  instanceCache = new Map<string, Promise<DirectMcpServer>>();
}
