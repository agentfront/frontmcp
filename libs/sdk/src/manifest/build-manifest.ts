import { type FrontMcpConfigInput } from '../common';
import { joinInstance } from '../direct/connect';
import { PublicMcpError } from '../errors';
import { type ConfigOrServerClass } from '../front-mcp/front-mcp';
import { type Scope } from '../scope/scope.instance';
import { buildServerManifest } from './build-server-manifest';
import { type ServerManifest } from './server-manifest.schema';

/**
 * Build the manifest of a server in process, without serving it: what `frontmcp build` writes to
 * `frontmcp.manifest.json`. A server `connect()` already serves in this process is reused.
 *
 * @param config - The `@FrontMcp` class, or its config object
 *
 * @example
 * ```typescript
 * import { buildManifest, lintServerManifest } from '@frontmcp/sdk';
 *
 * expect(lintServerManifest(await buildManifest(Server))).toEqual([]);
 * ```
 */
export async function buildManifest(config: ConfigOrServerClass): Promise<ServerManifest> {
  // A decorated class resolves to the config its decorator stored, as in `connect()`
  const { instancePromise, release } = joinInstance(config as FrontMcpConfigInput, 'manifest');
  try {
    const instance = await instancePromise;
    const primary = instance.getPrimaryScope() as Scope | undefined;
    if (!primary) {
      throw new PublicMcpError('No scopes initialized. Ensure at least one app is configured.', 'NO_SCOPES', 500);
    }
    return await buildServerManifest(instance.getScopes() as Scope[], primary);
  } finally {
    await release().catch(() => undefined);
  }
}
