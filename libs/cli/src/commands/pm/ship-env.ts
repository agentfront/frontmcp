import * as path from 'path';

import { envOverlayFor, resolveConfig, type ResolveMode } from '../../config';

/**
 * `env.shared` ⊕ `env.ship` from the `frontmcp.config` that governs `entry` (#680).
 *
 * The config is looked up from the entry's directory upwards (or at `configPath`),
 * not from the cwd: `frontmcp service` runs `frontmcp start` from wherever the
 * service manager starts it. Without a config the overlay is empty.
 *
 * Callers layer the real environment on top, so OS / CI / `.env` values win —
 * the same precedence as `dev` and `test`.
 */
export async function loadShipEnv(entry: string, mode: ResolveMode, configPath?: string): Promise<Record<string, string>> {
  const resolved = await resolveConfig({ cwd: path.dirname(entry), mode, configPath, env: {} });
  return envOverlayFor(resolved.config, mode);
}
