/**
 * SEA binary integration for the MCPB target.
 *
 * - `resolveHostPlatform()` maps the current process to an MCPB platform key.
 * - `mergeBinariesFrom()` scans a directory of pre-built CI binaries organized
 *   as `{platform}/{name}[.exe]` and reports what's available.
 * - `buildPlatformOverrides()` produces the `mcp_config.platform_overrides`
 *   block. MCPB hosts key it by `process.platform` only (`darwin`, `linux`,
 *   `win32`), so an OS gets an override only when every architecture of that
 *   OS has a binary; an OS with several architectures routes through a POSIX
 *   launcher (`bin/{os}/launch`) that picks `bin/{os}-{arch}/` by `uname -m`.
 *
 * Note: Node SEA can only build for the host OS/arch in a single pass. True
 * multi-platform archives need a CI matrix; the `mergeFrom` mechanism is how
 * those per-platform outputs get assembled into one `.mcpb`.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { McpbMcpConfig } from './manifest';
import type { McpbOsKey, McpbPlatformKey } from './constants';

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

export const LAUNCHER_FILE_NAME = 'launch';

export interface OsBinaryCoverage {
  os: McpbOsKey;
  binaries: BinaryEntry[];
  /** Architectures of this OS with no binary; the OS gets no override while any is missing. */
  missing: McpbPlatformKey[];
}

function osOf(platform: McpbPlatformKey): McpbOsKey {
  return platform.slice(0, platform.indexOf('-')) as McpbOsKey;
}

/** Group binaries by OS and report which architectures of each OS lack one. */
export function osBinaryCoverage(entries: BinaryEntry[]): OsBinaryCoverage[] {
  const osKeys = [...new Set(entries.map((entry) => osOf(entry.platform)))];
  return osKeys.map((os) => {
    const binaries = entries.filter((entry) => osOf(entry.platform) === os);
    const missing = MCPB_PLATFORM_KEYS.filter(
      (key) => osOf(key) === os && !binaries.some((entry) => entry.platform === key),
    );
    return { os, binaries, missing };
  });
}

/** POSIX launcher that runs the binary built for the host architecture. */
export function launcherScript(os: McpbOsKey, appName: string): string {
  return [
    '#!/bin/sh',
    'case "$(uname -m)" in',
    '  arm64|aarch64) arch=arm64 ;;',
    '  x86_64|amd64) arch=x64 ;;',
    `  *) echo "${appName}: no binary for $(uname -m)" >&2; exit 1 ;;`,
    'esac',
    `exec "$(dirname "$0")/../${os}-$arch/${appName}" "$@"`,
    '',
  ].join('\n');
}

/** Launchers to stage at `bin/{os}/launch` for each fully covered OS with several architectures. */
export function launcherFiles(entries: BinaryEntry[], appName: string): Array<{ os: McpbOsKey; content: string }> {
  return osBinaryCoverage(entries)
    .filter(({ binaries, missing }) => missing.length === 0 && binaries.length > 1)
    .map(({ os }) => ({ os, content: launcherScript(os, appName) }));
}

/**
 * Build the mcp_config.platform_overrides block, keyed by OS as MCPB hosts
 * match it. A single-architecture OS points at its binary; a multi-architecture
 * OS points at its launcher.
 */
export function buildPlatformOverrides(entries: BinaryEntry[]): Record<string, McpbMcpConfig> {
  const overrides: Record<string, McpbMcpConfig> = {};
  for (const { os, binaries, missing } of osBinaryCoverage(entries)) {
    if (missing.length > 0) continue;
    const target =
      binaries.length === 1 ? `${binaries[0].platform}/${binaries[0].fileName}` : `${os}/${LAUNCHER_FILE_NAME}`;
    overrides[os] = {
      command: `\${__dirname}/bin/${target}`,
      args: [],
      env: { FRONTMCP_STDIO: '1' },
    };
  }
  return overrides;
}
