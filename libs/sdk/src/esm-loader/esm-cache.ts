/**
 * @file esm-cache.ts
 * @description Cache manager for downloaded ESM bundles.
 *
 * Supports two modes:
 * - **Node.js**: File-based cache with .mjs bundles and metadata JSON
 * - **Browser**: In-memory cache (no file system access)
 *
 * The mode is auto-detected. In-memory cache is always used as a fast first-level cache,
 * with disk persistence as a second level in Node.js environments.
 */

import { sha256Hex } from '@frontmcp/utils';

/**
 * Detect if we're running in a browser environment.
 */
function isBrowserEnv(): boolean {
  return (
    typeof window !== 'undefined' || (typeof globalThis !== 'undefined' && typeof globalThis.document !== 'undefined')
  );
}

/**
 * Wrap CJS bundle content for ESM compatibility.
 * CJS bundles use `module.exports = ...` which isn't valid in .mjs files.
 * This wraps them with a module/exports shim and re-exports via `export default`.
 */
function wrapCjsForEsm(content: string): string {
  // If already ESM (has export/import statements), return as-is
  if (/\bexport\s+(default\b|{)/.test(content) || /\bimport\s+/.test(content)) {
    return content;
  }
  return [
    'const module = { exports: {} };',
    'const exports = module.exports;',
    content,
    'export default module.exports;',
  ].join('\n');
}

/**
 * Metadata stored alongside each cached ESM bundle.
 */
export interface EsmCacheEntry {
  /** Full package URL used to fetch */
  packageUrl: string;
  /** Full package name (e.g., '@acme/mcp-tools') */
  packageName: string;
  /** Concrete resolved version */
  resolvedVersion: string;
  /** Timestamp when cached */
  cachedAt: number;
  /** Path to the cached .mjs bundle file (Node.js only — empty in browser) */
  bundlePath: string;
  /** HTTP ETag for conditional requests */
  etag?: string;
  /** In-memory bundle content (used in browser mode and as fast cache in Node.js) */
  bundleContent?: string;
}

/**
 * Options for the ESM cache manager.
 */
export interface EsmCacheOptions {
  /**
   * Root cache directory for disk persistence. Environment-aware default:
   * - **Browser**: empty string (disk cache disabled, in-memory only)
   * - **Node.js server** (project has `node_modules/`): `{cwd}/node_modules/.cache/frontmcp-esm/`
   * - **CLI binary** (no `node_modules/`): `~/.frontmcp/esm-cache/`
   */
  cacheDir?: string;
  /** Maximum age of cached entries in milliseconds. Defaults to 24 hours. */
  maxAgeMs?: number;
}

/**
 * Determine the default cache directory based on the runtime environment.
 */
function getDefaultCacheDir(): string {
  // Browser: no file-based cache
  if (isBrowserEnv()) {
    return '';
  }

  try {
    const path = require('node:path');

    // When running inside a project with node_modules, use project-local cache.
    // This allows cached ESM bundles with externalized imports (@frontmcp/sdk, zod)
    // to resolve bare specifiers through the project's node_modules tree.
    try {
      const nodeModulesDir = path.join(process.cwd(), 'node_modules');
      const fs = require('node:fs');
      if (fs.existsSync(nodeModulesDir)) {
        return path.join(nodeModulesDir, '.cache', 'frontmcp-esm');
      }
    } catch {
      // Not in a project context
    }

    // Fallback: homedir cache (CLI binary, standalone, no project context)
    try {
      const os = require('node:os');
      return path.join(os.homedir(), '.frontmcp', 'esm-cache');
    } catch {
      // Restricted environment
    }

    return path.join(require('node:os').tmpdir?.() ?? '/tmp', '.frontmcp-esm-cache');
  } catch {
    // node:path not available (browser fallback)
    return '';
  }
}

const DEFAULT_CACHE_DIR = getDefaultCacheDir();

/** Default max age: 24 hours */
const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Cache manager for ESM bundles.
 *
 * **Node.js mode**: File-based disk cache with in-memory first-level cache.
 * ```
 * {cacheDir}/{hash}/
 *   bundle.mjs      - The ESM module code
 *   meta.json        - Cache metadata (version, timestamp, etag)
 * ```
 *
 * **Browser mode**: In-memory Map only (no file system).
 */
export class EsmCacheManager {
  private readonly cacheDir: string;
  private readonly maxAgeMs: number;
  private readonly memoryStore = new Map<string, EsmCacheEntry>();

  constructor(options?: EsmCacheOptions) {
    this.cacheDir = options?.cacheDir ?? DEFAULT_CACHE_DIR;
    this.maxAgeMs = options?.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  }

  /**
   * Get a cached ESM bundle entry if it exists and is not expired.
   */
  async get(packageName: string, version: string): Promise<EsmCacheEntry | undefined> {
    const memKey = `${packageName}@${version}`;

    // Check in-memory cache first (works in both browser and Node.js)
    const memEntry = this.memoryStore.get(memKey);
    if (memEntry) {
      if (Date.now() - memEntry.cachedAt <= this.maxAgeMs) {
        return memEntry;
      }
      this.memoryStore.delete(memKey);
    }

    // Disk cache (Node.js only)
    if (!this.cacheDir) return undefined;

    try {
      const path = require('node:path');
      const { fileExists, readJSON } = require('@frontmcp/utils');

      const entryDir = this.getEntryDir(packageName, version);
      const metaPath = path.join(entryDir, 'meta.json');

      if (!(await fileExists(metaPath))) {
        return undefined;
      }

      const meta = await (readJSON as (p: string) => Promise<EsmCacheEntry | null>)(metaPath);
      if (!meta) {
        return undefined;
      }

      if (Date.now() - meta.cachedAt > this.maxAgeMs) {
        return undefined;
      }

      if (!(await fileExists(meta.bundlePath))) {
        return undefined;
      }

      // Populate memory cache from disk
      this.memoryStore.set(memKey, meta);
      return meta;
    } catch {
      return undefined;
    }
  }

  /**
   * Store an ESM bundle in the cache.
   */
  async put(
    packageName: string,
    version: string,
    bundleContent: string,
    packageUrl: string,
    etag?: string,
  ): Promise<EsmCacheEntry> {
    const memKey = `${packageName}@${version}`;
    let bundlePath = '';

    // Persist to disk (Node.js only)
    if (this.cacheDir) {
      try {
        const path = require('node:path');
        const { writeFile, ensureDir, writeJSON } = require('@frontmcp/utils');

        const entryDir = this.getEntryDir(packageName, version);
        await ensureDir(entryDir);

        bundlePath = path.join(entryDir, 'bundle.mjs');
        await writeFile(bundlePath, wrapCjsForEsm(bundleContent));

        const diskEntry: EsmCacheEntry = {
          packageUrl,
          packageName,
          resolvedVersion: version,
          cachedAt: Date.now(),
          bundlePath,
          etag,
        };

        const metaPath = path.join(entryDir, 'meta.json');
        await writeJSON(metaPath, diskEntry);
      } catch {
        // Disk write failed (browser or restricted env) — memory cache is sufficient
      }
    }

    // Always store in memory (works in both browser and Node.js)
    const entry: EsmCacheEntry = {
      packageUrl,
      packageName,
      resolvedVersion: version,
      cachedAt: Date.now(),
      bundlePath,
      etag,
      bundleContent,
    };

    this.memoryStore.set(memKey, entry);
    return entry;
  }

  /**
   * Invalidate all cached versions for a package.
   */
  async invalidate(packageName: string): Promise<void> {
    // Clear from memory
    for (const [key, entry] of this.memoryStore) {
      if (entry.packageName === packageName) {
        this.memoryStore.delete(key);
      }
    }

    // Clear from disk (Node.js only)
    if (!this.cacheDir) return;

    try {
      const path = require('node:path');
      const { fileExists, readJSON, rm } = require('@frontmcp/utils');
      const { readdir } = await import('node:fs/promises');

      if (!(await fileExists(this.cacheDir))) {
        return;
      }

      let entries: string[];
      try {
        entries = await readdir(this.cacheDir);
      } catch {
        return;
      }

      for (const dirEntry of entries) {
        const metaPath = path.join(this.cacheDir, dirEntry, 'meta.json');
        if (await fileExists(metaPath)) {
          const meta = await (readJSON as (p: string) => Promise<EsmCacheEntry | null>)(metaPath);
          if (meta?.packageName === packageName) {
            await rm(path.join(this.cacheDir, dirEntry), { recursive: true, force: true });
          }
        }
      }
    } catch {
      // Disk operations not available
    }
  }

  /**
   * Remove expired cache entries.
   */
  async cleanup(maxAgeMs?: number): Promise<number> {
    const threshold = maxAgeMs ?? this.maxAgeMs;
    const now = Date.now();
    let removed = 0;

    // Clean memory (housekeeping — doesn't count toward removed total for disk-backed entries)
    for (const [key, entry] of this.memoryStore) {
      if (now - entry.cachedAt > threshold) {
        this.memoryStore.delete(key);
        // Only count as removed if there's no disk cache (browser-only mode)
        if (!this.cacheDir) removed++;
      }
    }

    // Clean disk (Node.js only) — this is the authoritative count
    if (!this.cacheDir) return removed;

    try {
      const path = require('node:path');
      const { fileExists, readJSON, rm } = require('@frontmcp/utils');
      const { readdir } = await import('node:fs/promises');

      if (!(await fileExists(this.cacheDir))) {
        return removed;
      }

      let entries: string[];
      try {
        entries = await readdir(this.cacheDir);
      } catch {
        return removed;
      }

      for (const dirEntry of entries) {
        const metaPath = path.join(this.cacheDir, dirEntry, 'meta.json');
        if (await fileExists(metaPath)) {
          const meta = await (readJSON as (p: string) => Promise<EsmCacheEntry | null>)(metaPath);
          if (meta && now - meta.cachedAt > threshold) {
            await rm(path.join(this.cacheDir, dirEntry), { recursive: true, force: true });
            removed++;
          }
        }
      }
    } catch {
      // Disk operations not available
    }

    return removed;
  }

  /**
   * Read the cached bundle content from a cache entry.
   */
  async readBundle(entry: EsmCacheEntry): Promise<string> {
    // In-memory content available (browser or populated cache)
    if (entry.bundleContent) {
      return entry.bundleContent;
    }

    // Read from disk (Node.js only)
    const { readFile } = require('@frontmcp/utils');
    return readFile(entry.bundlePath);
  }

  /**
   * Get the cache directory for a specific package+version combination.
   */
  private getEntryDir(packageName: string, version: string): string {
    const path = require('node:path');
    const hash = sha256Hex(`${packageName}@${version}`);
    return path.join(this.cacheDir, hash);
  }
}
