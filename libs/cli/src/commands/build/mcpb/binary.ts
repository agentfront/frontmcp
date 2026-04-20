/**
 * SEA binary integration for the MCPB target.
 *
 * - `resolveHostPlatform()` maps the current process to an MCPB platform key.
 * - `mergeBinariesFrom()` scans a directory of pre-built CI binaries organized
 *   as `{platform}/{name}[.exe]` and reports what's available.
 * - `buildPlatformOverrides()` produces the `mcp_config.platform_overrides`
 *   block that routes the MCPB consumer to the binary matching its OS/arch.
 *
 * Note: Node SEA can only build for the host OS/arch in a single pass. True
 * multi-platform archives need a CI matrix; the `mergeFrom` mechanism is how
 * those per-platform outputs get assembled into one `.mcpb`.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { McpbMcpConfig } from './manifest';
import type { McpbPlatformKey } from './constants';

export const MCPB_PLATFORM_KEYS: McpbPlatformKey[] = [
  'darwin-arm64',
  'darwin-x64',
  'linux-arm64',
  'linux-x64',
  'win32-x64',
];

/** Map the current Node.js process to its MCPB platform key. */
export function resolveHostPlatform(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): McpbPlatformKey | undefined {
  const key = `${platform}-${arch}` as McpbPlatformKey;
  return MCPB_PLATFORM_KEYS.includes(key) ? key : undefined;
}

/** Windows needs `.exe` appended to the binary name. */
export function binaryFileName(appName: string, platform: McpbPlatformKey): string {
  return platform.startsWith('win32') ? `${appName}.exe` : appName;
}

export interface BinaryEntry {
  platform: McpbPlatformKey;
  /** Absolute path of the source binary on disk. */
  srcPath: string;
  /** Destination filename (e.g., myapp or myapp.exe). */
  fileName: string;
}

/**
 * Scan `{mergeFromDir}/{platform}/{name}` paths and return the binaries found.
 * Silently skips entries with unknown platform folders.
 */
export function mergeBinariesFrom(mergeFromDir: string, appName: string): BinaryEntry[] {
  if (!fs.existsSync(mergeFromDir) || !fs.statSync(mergeFromDir).isDirectory()) {
    return [];
  }
  const results: BinaryEntry[] = [];
  for (const platform of MCPB_PLATFORM_KEYS) {
    const file = binaryFileName(appName, platform);
    const candidate = path.join(mergeFromDir, platform, file);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      results.push({ platform, srcPath: candidate, fileName: file });
    }
  }
  return results;
}

/**
 * Build the mcp_config.platform_overrides block for the given set of platform
 * binaries. Each override points at `${__dirname}/bin/{platform}/{file}`.
 */
export function buildPlatformOverrides(
  entries: BinaryEntry[],
): Record<string, McpbMcpConfig> {
  const overrides: Record<string, McpbMcpConfig> = {};
  for (const { platform, fileName } of entries) {
    overrides[platform] = {
      command: `\${__dirname}/bin/${platform}/${fileName}`,
      args: [],
    };
  }
  return overrides;
}
