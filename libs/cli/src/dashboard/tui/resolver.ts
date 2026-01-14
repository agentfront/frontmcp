/**
 * Platform-specific binary resolver for the Ratatui TUI
 *
 * Resolves the correct platform-specific npm package containing the
 * pre-compiled Rust binary for the frontmcp-tui dashboard.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Platform/architecture to package name mapping
 * Follows the Biome/SWC pattern for distributing Rust binaries via npm
 */
const PLATFORM_PACKAGES: Record<string, Record<string, string>> = {
  darwin: {
    arm64: '@frontmcp/tui-darwin-arm64',
    x64: '@frontmcp/tui-darwin-x64',
  },
  linux: {
    arm64: '@frontmcp/tui-linux-arm64-gnu',
    x64: '@frontmcp/tui-linux-x64-gnu',
  },
  win32: {
    x64: '@frontmcp/tui-win32-x64-msvc',
  },
};

/**
 * Binary name per platform
 */
function getBinaryName(): string {
  return process.platform === 'win32' ? 'frontmcp-tui.exe' : 'frontmcp-tui';
}

/**
 * Try to resolve the platform-specific package and return the binary path
 * Returns null if the binary is not available
 */
export function resolveTuiBinary(): string | null {
  const platform = process.platform;
  const arch = process.arch;

  const binaryName = getBinaryName();

  // Method 0: Check local development build first (crates/target/release)
  // This allows local development without publishing npm packages
  const localDevPaths = [
    // From libs/cli/dist/src/dashboard/tui -> crates/target/release
    path.join(__dirname, '..', '..', '..', '..', '..', '..', 'crates', 'target', 'release', binaryName),
    // From libs/cli/src/dashboard/tui -> crates/target/release (when running with tsx)
    path.join(__dirname, '..', '..', '..', '..', 'crates', 'target', 'release', binaryName),
  ];

  for (const devPath of localDevPaths) {
    try {
      if (fs.existsSync(devPath) && fs.statSync(devPath).isFile()) {
        if (process.platform !== 'win32') {
          fs.accessSync(devPath, fs.constants.X_OK);
        }
        return devPath;
      }
    } catch {
      // Try next path
    }
  }

  // Check if platform is supported
  const archMap = PLATFORM_PACKAGES[platform];
  if (!archMap) {
    return null;
  }

  // Check if architecture is supported
  const packageName = archMap[arch];
  if (!packageName) {
    return null;
  }

  // Try to resolve the package
  try {
    // Method 1: Try require.resolve for the package's binary
    // Try to find the package in node_modules
    const possiblePaths = [
      // Relative to this file (for npm installs)
      path.join(__dirname, '..', '..', '..', '..', 'node_modules', packageName, binaryName),
      // Workspace root node_modules
      path.join(__dirname, '..', '..', '..', '..', '..', 'node_modules', packageName, binaryName),
      // Global node_modules
      path.join(require.resolve.paths(packageName)?.[0] ?? '', packageName, binaryName),
    ];

    for (const binPath of possiblePaths) {
      try {
        if (fs.existsSync(binPath) && fs.statSync(binPath).isFile()) {
          // Verify it's executable (on Unix)
          if (process.platform !== 'win32') {
            fs.accessSync(binPath, fs.constants.X_OK);
          }
          return binPath;
        }
      } catch {
        // Try next path
      }
    }

    // Method 2: Try to require the package and look for exports
    try {
      const pkgPath = require.resolve(`${packageName}/package.json`);
      const pkgDir = path.dirname(pkgPath);
      const binPath = path.join(pkgDir, binaryName);

      if (fs.existsSync(binPath)) {
        return binPath;
      }
    } catch {
      // Package not installed
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Get the platform-specific package name for the current platform
 * Returns null if the platform is not supported
 */
export function getPlatformPackageName(): string | null {
  const platform = process.platform;
  const arch = process.arch;

  const archMap = PLATFORM_PACKAGES[platform];
  if (!archMap) {
    return null;
  }

  return archMap[arch] ?? null;
}

/**
 * Check if the current platform is supported
 */
export function isPlatformSupported(): boolean {
  return getPlatformPackageName() !== null;
}
