/**
 * Install source parsing and types.
 */

export type InstallSourceType = 'npm' | 'local' | 'git' | 'esm';

export interface InstallSource {
  type: InstallSourceType;
  ref: string;
}

export interface FrontmcpRegistry {
  version: 1;
  apps: Record<
    string,
    {
      version: string;
      installDir: string;
      installedAt: string;
      runner: string;
      bundle: string;
      storage: 'sqlite' | 'redis' | 'none';
      port: number;
      source?: { type: InstallSourceType; ref: string };
      /** Resolved ESM version (for ESM-loaded apps) */
      esmVersion?: string;
      /** Path to cached ESM bundle */
      esmCachePath?: string;
      /** ISO timestamp of last update check */
      lastUpdateCheck?: string;
    }
  >;
}

/**
 * Parse an install source string into a typed source object.
 *
 * - Starts with `./ | ../ | /`  → local
 * - Starts with `github:` or `git+` or ends with `.git`  → git
 * - Everything else  → npm
 */
export function parseInstallSource(source: string): InstallSource {
  if (source.startsWith('./') || source.startsWith('../') || source.startsWith('/')) {
    return { type: 'local', ref: source };
  }

  // ESM sources: explicit esm.sh URL or esm: prefix (checked before git to avoid esm:...pkg.git misclassification)
  if (source.startsWith('https://esm.sh/') || source.startsWith('esm:')) {
    return { type: 'esm', ref: source.replace(/^esm:/, '') };
  }

  if (source.startsWith('github:') || source.startsWith('git+') || source.endsWith('.git')) {
    return { type: 'git', ref: source };
  }

  return { type: 'npm', ref: source };
}
