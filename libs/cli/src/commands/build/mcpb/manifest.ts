/**
 * MCPB manifest generator + Zod schema for the emitted manifest.
 *
 * Source priority when resolving fields:
 *   deployment.* (frontmcp.config)  >  package.json  >  hard defaults
 *
 * See https://github.com/modelcontextprotocol/mcpb/blob/main/MANIFEST.md
 */

import * as fs from 'fs';
import * as path from 'path';
import { z } from '@frontmcp/lazy-zod';
import { type ExtractedSchema, SYSTEM_TOOL_NAMES } from '../exec/cli-runtime/schema-extractor';
import type {
  McpbAuthor,
  McpbCompatibility,
  McpbDeployment,
  McpbRepository,
  McpbUserConfigEntry,
} from '../../../config/frontmcp-config.types';
import {
  DEFAULT_NODE_COMPAT,
  DEFAULT_PLATFORMS,
  MCPB_MANIFEST_VERSION,
} from './constants';

// ============================================
// Emitted manifest shape (MCPB v0.3 subset we produce)
// ============================================

export interface McpbMcpConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  platform_overrides?: Record<string, McpbMcpConfig>;
}

export interface McpbManifest {
  manifest_version: string;
  name: string;
  version: string;
  description: string;
  display_name?: string;
  long_description?: string;
  author: McpbAuthor;
  license?: string;
  homepage?: string;
  repository?: { type: string; url: string };
  documentation?: string;
  support?: string;
  icon?: string;
  keywords?: string[];
  privacy_policies?: string[];
  compatibility?: McpbCompatibility;
  server: {
    type: 'node' | 'python' | 'binary' | 'uv';
    entry_point: string;
    mcp_config: McpbMcpConfig;
  };
  tools?: Array<{ name: string; description: string }>;
  tools_generated?: boolean;
  resources?: Array<{ name?: string; uri: string; description?: string; mimeType?: string }>;
  resources_generated?: boolean;
  prompts?: Array<{ name: string; description?: string }>;
  prompts_generated?: boolean;
  user_config?: Record<string, McpbUserConfigEntry>;
  _meta?: Record<string, unknown>;
}

// ============================================
// Zod schema (used by validate.ts)
// ============================================

const authorSchema = z
  .object({
    name: z.string(),
    email: z.string().optional(),
    url: z.string().optional(),
  })
  .strict();

const userConfigEntrySchema = z
  .object({
    type: z.enum(['string', 'number', 'boolean', 'directory', 'file']),
    title: z.string(),
    description: z.string().optional(),
    required: z.boolean().optional(),
    default: z.union([z.string(), z.number(), z.boolean()]).optional(),
    multiple: z.boolean().optional(),
    sensitive: z.boolean().optional(),
    min: z.number().optional(),
    max: z.number().optional(),
  })
  .strict();

const mcpConfigSchema: z.ZodType<McpbMcpConfig> = z.lazy(() =>
  z
    .object({
      command: z.string(),
      args: z.array(z.string()).optional(),
      env: z.record(z.string(), z.string()).optional(),
      platform_overrides: z.record(z.string(), mcpConfigSchema).optional(),
    })
    .strict(),
);

export const mcpbManifestSchema = z
  .object({
    manifest_version: z.string(),
    name: z.string().min(1),
    version: z.string().min(1),
    description: z.string(),
    display_name: z.string().optional(),
    long_description: z.string().optional(),
    author: authorSchema,
    license: z.string().optional(),
    homepage: z.string().optional(),
    repository: z
      .object({ type: z.string(), url: z.string() })
      .strict()
      .optional(),
    documentation: z.string().optional(),
    support: z.string().optional(),
    icon: z.string().optional(),
    keywords: z.array(z.string()).optional(),
    privacy_policies: z.array(z.string()).optional(),
    compatibility: z
      .object({
        claude_desktop: z.string().optional(),
        platforms: z.array(z.enum(['darwin', 'win32', 'linux'])).optional(),
        runtimes: z
          .object({ node: z.string().optional(), python: z.string().optional() })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    server: z
      .object({
        type: z.enum(['node', 'python', 'binary', 'uv']),
        entry_point: z.string(),
        mcp_config: mcpConfigSchema,
      })
      .strict(),
    tools: z
      .array(z.object({ name: z.string(), description: z.string() }).strict())
      .optional(),
    tools_generated: z.boolean().optional(),
    resources: z
      .array(
        z
          .object({
            name: z.string().optional(),
            uri: z.string(),
            description: z.string().optional(),
            mimeType: z.string().optional(),
          })
          .strict(),
      )
      .optional(),
    resources_generated: z.boolean().optional(),
    prompts: z
      .array(
        z
          .object({ name: z.string(), description: z.string().optional() })
          .strict(),
      )
      .optional(),
    prompts_generated: z.boolean().optional(),
    user_config: z.record(z.string(), userConfigEntrySchema).optional(),
    _meta: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

// ============================================
// Sources + helpers
// ============================================

export interface PackageJsonMeta {
  name?: string;
  version?: string;
  description?: string;
  author?: string | McpbAuthor;
  license?: string;
  homepage?: string;
  repository?: string | { type?: string; url?: string };
  keywords?: string[];
  icon?: string;
}

/** Read and parse package.json from the given directory. Returns {} if absent. */
export function loadPackageJsonMeta(cwd: string): PackageJsonMeta {
  const pkgPath = path.join(cwd, 'package.json');
  if (!fs.existsSync(pkgPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as PackageJsonMeta;
  } catch {
    return {};
  }
}

/**
 * Parse npm-style "Name <email> (url)" into an McpbAuthor.
 * Falls back to `{ name: <raw> }` when parsing fails.
 */
export function parseAuthor(author: unknown): McpbAuthor {
  if (!author) return { name: 'unknown' };
  if (typeof author === 'object' && 'name' in author) {
    const a = author as McpbAuthor;
    return {
      name: a.name,
      ...(a.email ? { email: a.email } : {}),
      ...(a.url ? { url: a.url } : {}),
    };
  }
  if (typeof author !== 'string') {
    return { name: String(author) };
  }
  const match = author.match(/^([^<(]+?)(?:\s*<([^>]+)>)?(?:\s*\(([^)]+)\))?$/);
  if (!match || !match[1]) return { name: author };
  const [, name, email, url] = match;
  return {
    name: name.trim(),
    ...(email ? { email: email.trim() } : {}),
    ...(url ? { url: url.trim() } : {}),
  };
}

/** Normalize repository field (string → {type, url}). */
export function normalizeRepository(
  repo: McpbRepository | PackageJsonMeta['repository'] | undefined,
): { type: string; url: string } | undefined {
  if (!repo) return undefined;
  if (typeof repo === 'string') {
    return { type: 'git', url: repo };
  }
  if (typeof repo === 'object' && repo.url) {
    return { type: repo.type || 'git', url: repo.url };
  }
  return undefined;
}

/** Resolve first-existing icon path. */
export function resolveIconPath(cwd: string, deploymentIcon?: string, pkgIcon?: string): string | undefined {
  const candidates = [deploymentIcon, pkgIcon, 'icon.png', 'assets/icon.png'].filter(
    (x): x is string => !!x,
  );
  for (const rel of candidates) {
    if (fs.existsSync(path.resolve(cwd, rel))) {
      return rel;
    }
  }
  return undefined;
}

// ============================================
// Generator input + output
// ============================================

export interface GenerateMcpbManifestInput {
  /** Resolved server name. */
  name: string;
  /** Resolved server version. */
  version: string;
  /** Optional resolved node version range (e.g., ">=22.0.0"). */
  nodeVersion?: string;
  /** Project root. Used for icon resolution and package.json fallback. */
  cwd: string;
  /** Deployment config from frontmcp.config (may be undefined). */
  deployment?: McpbDeployment;
  /** Schema extracted from the compiled server bundle. */
  schema: ExtractedSchema;
  /** env → user_config reference map built by user-config.ts. */
  userConfigEnv: Record<string, string>;
  /** user_config entries built by user-config.ts. */
  userConfig: Record<string, McpbUserConfigEntry>;
  /** platform_overrides from binary.ts (may be empty). */
  platformOverrides?: Record<string, McpbMcpConfig>;
  /** Whether an icon was copied into the staged archive root. */
  hasIcon?: boolean;
  /** Tool name of the CLI version emitting this manifest (for _meta). */
  cliVersion?: string;
}

/** Produce the final MCPB manifest object. */
export function generateMcpbManifest(input: GenerateMcpbManifestInput): McpbManifest {
  const {
    name,
    version,
    cwd,
    deployment,
    schema,
    userConfig,
    userConfigEnv,
    platformOverrides,
    hasIcon,
    cliVersion,
  } = input;

  const pkg = loadPackageJsonMeta(cwd);

  const description = deployment?.longDescription?.split('\n')[0]?.trim()
    || pkg.description
    || '';

  const author = deployment?.author || parseAuthor(pkg.author);
  const license = deployment?.license ?? pkg.license;
  const homepage = deployment?.homepage ?? pkg.homepage;
  const repository = normalizeRepository(deployment?.repository ?? pkg.repository);
  const keywords = deployment?.keywords ?? pkg.keywords;
  const icon = hasIcon ? 'icon.png' : undefined;

  const nodeVersion = deployment?.compatibility?.runtimes?.node
    ?? input.nodeVersion
    ?? DEFAULT_NODE_COMPAT;

  const compatibility: McpbCompatibility = {
    ...(deployment?.compatibility?.claude_desktop
      ? { claude_desktop: deployment.compatibility.claude_desktop }
      : {}),
    platforms: deployment?.compatibility?.platforms ?? [...DEFAULT_PLATFORMS],
    runtimes: {
      ...(deployment?.compatibility?.runtimes?.python
        ? { python: deployment.compatibility.runtimes.python }
        : {}),
      node: nodeVersion,
    },
  };

  const tools = schema.tools
    .filter((t) => !SYSTEM_TOOL_NAMES.has(t.name))
    .map((t) => ({ name: t.name, description: t.description || '' }));

  // #376 — emit resources alongside tools/prompts. The server runtime
  // already registers @Resource entries, but the manifest writer was
  // dropping them, so MCPB-aware clients had no way to discover them.
  const resources = schema.resources.map((r) => ({
    ...(r.name ? { name: r.name } : {}),
    uri: r.uri,
    ...(r.description ? { description: r.description } : {}),
    ...(r.mimeType ? { mimeType: r.mimeType } : {}),
  }));

  const prompts = schema.prompts.map((p) => ({
    name: p.name,
    ...(p.description ? { description: p.description } : {}),
  }));

  const mcpConfig: McpbMcpConfig = {
    command: 'node',
    args: ['${__dirname}/server/index.js'],
    ...(Object.keys(userConfigEnv).length > 0 ? { env: userConfigEnv } : {}),
    ...(platformOverrides && Object.keys(platformOverrides).length > 0
      ? { platform_overrides: platformOverrides }
      : {}),
  };

  const manifest: McpbManifest = {
    manifest_version: MCPB_MANIFEST_VERSION,
    name,
    version,
    description,
    ...(deployment?.displayName ? { display_name: deployment.displayName } : {}),
    ...(deployment?.longDescription
      ? { long_description: deployment.longDescription }
      : {}),
    author,
    ...(license ? { license } : {}),
    ...(homepage ? { homepage } : {}),
    ...(repository ? { repository } : {}),
    ...(deployment?.documentation ? { documentation: deployment.documentation } : {}),
    ...(deployment?.support ? { support: deployment.support } : {}),
    ...(icon ? { icon } : {}),
    ...(keywords && keywords.length > 0 ? { keywords } : {}),
    ...(deployment?.privacyPolicies && deployment.privacyPolicies.length > 0
      ? { privacy_policies: deployment.privacyPolicies }
      : {}),
    compatibility,
    server: {
      type: 'node',
      entry_point: 'server/index.js',
      mcp_config: mcpConfig,
    },
    tools,
    tools_generated: false,
    ...(resources.length > 0
      ? {
          resources,
          // FrontMCP resources resolve dynamically (their bodies come from
          // execute()/read()), so consumers should still query the server at
          // runtime — but the static manifest now exposes name/uri/mimeType.
          resources_generated: true,
        }
      : {}),
    prompts,
    // FrontMCP prompts resolve dynamically via execute() — MCPB's static `text`
    // template cannot represent JS logic. Set generated:true so consumers query
    // the server at runtime while still getting name/description hints here.
    prompts_generated: true,
    ...(Object.keys(userConfig).length > 0 ? { user_config: userConfig } : {}),
    _meta: {
      'dev.frontmcp.generator': cliVersion ? `frontmcp@${cliVersion}` : 'frontmcp',
      'dev.frontmcp.capabilities': schema.capabilities,
    },
  };

  return manifest;
}
