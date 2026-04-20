/**
 * Validate a `.mcpb` archive against the subset of MCPB v0.3 that FrontMCP
 * emits. Surfaces problems clients would hit when loading the bundle.
 *
 * Checks performed:
 *   1. Archive opens as a zip
 *   2. `manifest.json` exists and parses as JSON
 *   3. Manifest matches `mcpbManifestSchema`
 *   4. `server.entry_point` resolves to an entry inside the archive
 *   5. Every `${user_config.KEY}` reference declares matching user_config[KEY]
 *   6. Only allow-listed variables appear in substitutions
 *   7. `manifest.icon` file exists when referenced
 *   8. No zip-slip (normalized entry names escaping the archive root)
 *   9. Warnings on large archives, absolute-path args, node_modules presence
 */

import * as fs from 'fs';
import * as path from 'path';
import type { Entry, ZipFile } from 'yauzl';
import { mcpbManifestSchema, type McpbManifest, type McpbMcpConfig } from './manifest';
import { ALLOWED_SUBSTITUTION_VARS, ARCHIVE_SIZE_ERROR, ARCHIVE_SIZE_WARN, USER_CONFIG_PREFIX } from './constants';

export interface ValidateResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  manifest?: McpbManifest;
  entries?: string[];
  /** Archive size in bytes. */
  size?: number;
}

/** Validate a `.mcpb` archive at the given path. */
export async function validateMcpb(archivePath: string): Promise<ValidateResult> {
  const result: ValidateResult = { ok: false, errors: [], warnings: [] };

  let archive: { entries: string[]; manifestRaw?: string; size: number };
  try {
    archive = await readArchive(archivePath);
  } catch (err) {
    result.errors.push(`Cannot open archive: ${(err as Error).message}`);
    return result;
  }

  result.entries = archive.entries;
  result.size = archive.size;

  if (archive.size > ARCHIVE_SIZE_ERROR) {
    result.warnings.push(
      `Archive is ${(archive.size / 1024 / 1024).toFixed(1)} MB — consider tuning esbuild externals or disabling node_modules inclusion`,
    );
  } else if (archive.size > ARCHIVE_SIZE_WARN) {
    result.warnings.push(`Archive is ${(archive.size / 1024 / 1024).toFixed(1)} MB`);
  }

  // Zip-slip: flag entries that escape the archive root.
  // Substring-matching `..` would false-positive on legit names like `foo..bar`,
  // so we normalize and check for literal `..` segments plus absolute paths.
  for (const entry of archive.entries) {
    if (isUnsafeArchivePath(entry)) {
      result.errors.push(`Zip-slip risk: entry "${entry}"`);
    }
  }

  if (archive.entries.some((e) => e.startsWith('server/node_modules/'))) {
    result.warnings.push('Archive contains server/node_modules/ — opt-in only; verify this was intentional');
  }

  if (!archive.manifestRaw) {
    result.errors.push('manifest.json is missing from the archive root');
    return result;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(archive.manifestRaw);
  } catch (err) {
    result.errors.push(`manifest.json is not valid JSON: ${(err as Error).message}`);
    return result;
  }

  const schemaResult = mcpbManifestSchema.safeParse(parsed);
  if (!schemaResult.success) {
    const issues = schemaResult.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    result.errors.push(`manifest.json fails schema: ${issues}`);
    return result;
  }

  const manifest = schemaResult.data as McpbManifest;
  result.manifest = manifest;

  // entry_point must live in the archive
  if (!archive.entries.includes(manifest.server.entry_point)) {
    result.errors.push(
      `server.entry_point "${manifest.server.entry_point}" is not present in the archive`,
    );
  }

  // Variable substitution + user_config cross-check
  checkMcpConfig(manifest.server.mcp_config, manifest.user_config, result);

  // Icon existence
  if (manifest.icon && !archive.entries.includes(manifest.icon)) {
    result.errors.push(`icon "${manifest.icon}" is not present in the archive`);
  }

  // Binary references declared via platform_overrides must exist
  const overrides = manifest.server.mcp_config.platform_overrides || {};
  for (const [platform, cfg] of Object.entries(overrides)) {
    const cmd = cfg.command;
    const entryName = stripDirname(cmd);
    if (entryName && !archive.entries.includes(entryName)) {
      result.errors.push(
        `platform_overrides["${platform}"].command points to "${entryName}" which is not in the archive`,
      );
    }
  }

  result.ok = result.errors.length === 0;
  return result;
}

function checkMcpConfig(
  cfg: McpbMcpConfig,
  userConfig: Record<string, unknown> | undefined,
  result: ValidateResult,
): void {
  const declared = new Set(Object.keys(userConfig ?? {}));
  const valuesToScan: string[] = [cfg.command, ...(cfg.args ?? [])];
  if (cfg.env) valuesToScan.push(...Object.values(cfg.env));
  for (const value of valuesToScan) {
    verifySubstitutions(value, declared, result);
    if (isAbsolutePath(value) && !value.startsWith('${__dirname}')) {
      result.warnings.push(`Absolute path in mcp_config: "${value}" — consider using \${__dirname}`);
    }
  }
  if (cfg.platform_overrides) {
    for (const [platform, nested] of Object.entries(cfg.platform_overrides)) {
      checkMcpConfig(nested, userConfig, result);
      void platform;
    }
  }
}

function verifySubstitutions(value: string, declared: Set<string>, result: ValidateResult): void {
  const re = /\$\{([^}]+)\}/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(value)) !== null) {
    const variable = match[1];
    if (variable.startsWith(USER_CONFIG_PREFIX)) {
      const key = variable.slice(USER_CONFIG_PREFIX.length);
      if (!declared.has(key)) {
        result.errors.push(`Unknown user_config reference: "${variable}"`);
      }
      continue;
    }
    if (!ALLOWED_SUBSTITUTION_VARS.has(variable)) {
      result.errors.push(`Unknown substitution variable: "\${${variable}}"`);
    }
  }
}

function isAbsolutePath(value: string): boolean {
  if (!value) return false;
  if (value.startsWith('/')) return true;
  return /^[a-zA-Z]:[\\/]/.test(value); // C:\ or C:/
}

/** Strip a leading ${__dirname}/ from a command path, returning the in-archive entry. */
function stripDirname(command: string): string | undefined {
  const prefix = '${__dirname}/';
  return command.startsWith(prefix) ? command.slice(prefix.length) : undefined;
}

interface RawArchive {
  entries: string[];
  manifestRaw?: string;
  size: number;
}

function readArchive(archivePath: string): Promise<RawArchive> {
  const yauzl = require('yauzl') as typeof import('yauzl');
  // yauzl's ZipFile doesn't expose the archive byte size, so measure it
  // directly from disk. stat before open mirrors the error path for missing
  // files.
  const size = fs.statSync(archivePath).size;
  return new Promise<RawArchive>((resolve, reject) => {
    yauzl.open(archivePath, { lazyEntries: true }, (err: Error | null, zip: ZipFile | undefined) => {
      if (err || !zip) {
        reject(err || new Error('yauzl returned no handle'));
        return;
      }
      const entries: string[] = [];
      let manifestRaw: string | undefined;
      let settled = false;
      const settle = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        try {
          zip.close();
        } catch {
          // best-effort close — don't mask the original error
        }
        fn();
      };

      zip.readEntry();
      zip.on('entry', (entry: Entry) => {
        entries.push(entry.fileName);
        if (entry.fileName === 'manifest.json') {
          zip.openReadStream(entry, (streamErr: Error | null, stream: NodeJS.ReadableStream | undefined) => {
            if (streamErr || !stream) {
              settle(() => reject(streamErr || new Error('Failed to open manifest stream')));
              return;
            }
            const chunks: Buffer[] = [];
            stream.on('data', (chunk: Buffer) => chunks.push(chunk));
            stream.on('end', () => {
              manifestRaw = Buffer.concat(chunks).toString('utf-8');
              zip.readEntry();
            });
            stream.on('error', (e: Error) => settle(() => reject(e)));
          });
        } else {
          zip.readEntry();
        }
      });
      zip.on('end', () => {
        settle(() => resolve({ entries, manifestRaw, size }));
      });
      zip.on('error', (e: Error) => settle(() => reject(e)));
    });
  });
}

/**
 * A zip entry is unsafe if it uses an absolute path or any normalized segment
 * would let it escape the archive root (`..`). Backslashes are also rejected
 * so Windows-style paths can't bypass the POSIX check.
 */
function isUnsafeArchivePath(entry: string): boolean {
  if (!entry) return false;
  if (entry.startsWith('/') || entry.includes('\\')) return true;
  if (/^[a-zA-Z]:/.test(entry)) return true; // drive-letter absolute
  const normalized = path.posix.normalize(entry);
  if (normalized.startsWith('../') || normalized === '..') return true;
  return normalized.split('/').some((segment) => segment === '..');
}
