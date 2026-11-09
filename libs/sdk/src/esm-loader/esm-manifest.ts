/**
 * @file esm-manifest.ts
 * @description Package manifest interface and normalizer for ESM-loaded packages.
 * Defines the contract that npm packages must follow to be loadable by FrontMCP.
 */

import { getMetadata } from '@frontmcp/di';
import { internalZ as z } from '@frontmcp/lazy-zod';

import { collectAppMetadata } from '../app/app.utils';
import {
  isDecoratedAgentClass,
  isDecoratedJobClass,
  isDecoratedPromptClass,
  isDecoratedProviderClass,
  isDecoratedResourceClass,
  isDecoratedSkillClass,
  isDecoratedToolClass,
  isDecoratedWorkflowClass,
} from '../app/instances/esm-normalize.utils';
import { getDecoratorConfig } from '../common/decorators/front-mcp.decorator';
import type { AppType } from '../common/interfaces';
import { FrontMcpLocalAppTokens } from '../common/tokens/app.tokens';

/**
 * The manifest that ESM packages export to declare their MCP primitives.
 *
 * Package authors export this as the default export of their package:
 * ```typescript
 * export default {
 *   name: '@acme/mcp-tools',
 *   version: '1.0.0',
 *   tools: [SearchTool, CreateIssueTool],
 *   skills: [{ name: 'triage', ... }],
 * } satisfies FrontMcpPackageManifest;
 * ```
 */
export interface FrontMcpPackageManifest {
  /** Package name (should match npm package name) */
  name: string;
  /** Package version (should match npm package version) */
  version: string;
  /** Package description */
  description?: string;
  /** Tool classes or function-style tools */
  tools?: unknown[];
  /** Prompt classes or function-style prompts */
  prompts?: unknown[];
  /** Resource classes or function-style resources */
  resources?: unknown[];
  /** Skill definitions (can include embedded tools via the skill's tools array) */
  skills?: unknown[];
  /** Agent classes or function-style agents */
  agents?: unknown[];
  /** Job classes or function-style jobs */
  jobs?: unknown[];
  /** Workflow classes or function-style workflows */
  workflows?: unknown[];
  /** Shared providers for dependency injection */
  providers?: unknown[];
}

/**
 * Zod schema for basic manifest validation.
 * We validate the shape loosely since the actual primitives are validated
 * by their respective registries during registration.
 */
export const frontMcpPackageManifestSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  description: z.string().optional(),
  tools: z.array(z.unknown()).optional(),
  prompts: z.array(z.unknown()).optional(),
  resources: z.array(z.unknown()).optional(),
  skills: z.array(z.unknown()).optional(),
  agents: z.array(z.unknown()).optional(),
  jobs: z.array(z.unknown()).optional(),
  workflows: z.array(z.unknown()).optional(),
  providers: z.array(z.unknown()).optional(),
});

/**
 * Primitive type keys available in a manifest.
 */
export const MANIFEST_PRIMITIVE_KEYS = [
  'tools',
  'prompts',
  'resources',
  'skills',
  'agents',
  'jobs',
  'workflows',
  'providers',
] as const;

export type ManifestPrimitiveKey = (typeof MANIFEST_PRIMITIVE_KEYS)[number];

/**
 * Normalize the default export of an ESM module into a FrontMcpPackageManifest.
 *
 * Handles five formats:
 * 1. A plain manifest object with tools/prompts/etc arrays
 * 2. A class decorated with @App or @FrontMcp (its entries, and those of a @FrontMcp server's @App classes)
 * 3. A module with named exports (tools, prompts, etc. arrays)
 * 4. A single default export of a decorated primitive class (@Tool, @Resource, etc.)
 * 5. Named exports of individual decorated classes (scanned and grouped by type)
 *
 * @param moduleExport - The raw module export (result of dynamic import())
 * @returns Normalized FrontMcpPackageManifest
 * @throws Error if the export cannot be normalized
 */
export function normalizeEsmExport(moduleExport: unknown): FrontMcpPackageManifest {
  if (!moduleExport || typeof moduleExport !== 'object') {
    throw new Error('ESM module export must be an object');
  }

  const mod = moduleExport as Record<string, unknown>;

  // Case 1: Module has a `default` export
  if ('default' in mod && mod['default']) {
    const defaultExport = mod['default'] as Record<string, unknown>;

    // Case 1a: Default export is a plain manifest object
    if (isManifestObject(defaultExport)) {
      return validateManifest(defaultExport);
    }

    // Case 1b: Default export is an @App- or @FrontMcp-decorated class
    if (isDecoratedAppClass(defaultExport)) {
      return manifestOfApp(defaultExport);
    }
    const serverConfig = getDecoratorConfig(defaultExport);
    if (serverConfig) {
      return manifestOfServer(serverConfig);
    }

    // Case 1c: Default export is a single decorated primitive class (@Tool, @Resource, etc.)
    if (isDecoratedPrimitive(defaultExport)) {
      return collectDecoratedExports({ default: defaultExport });
    }

    // Case 1d: Default is itself a module-like object with named exports
    if (hasManifestPrimitives(defaultExport)) {
      return collectNamedExports(defaultExport);
    }

    // Case 1e: Default is a module-like object with decorated class exports
    if (hasDecoratedClassExports(defaultExport)) {
      return collectDecoratedExports(defaultExport);
    }
  }

  // Case 2: Module itself is a manifest object
  if (isManifestObject(mod)) {
    return validateManifest(mod);
  }

  // Case 3: Module has named exports with primitive arrays
  if (hasManifestPrimitives(mod)) {
    return collectNamedExports(mod);
  }

  // Case 4: Module has named exports of individual decorated classes
  if (hasDecoratedClassExports(mod)) {
    return collectDecoratedExports(mod);
  }

  throw new Error(
    'ESM module does not export a valid FrontMcpPackageManifest. ' +
      'Expected a default export with { name, version, tools?, ... }, ' +
      'named exports of primitive arrays, or exported decorated classes (@Tool, @Resource, etc.).',
  );
}

/**
 * Check if an object looks like a FrontMcpPackageManifest (has name + version).
 */
function isManifestObject(obj: Record<string, unknown>): boolean {
  return typeof obj['name'] === 'string' && typeof obj['version'] === 'string';
}

/** Whether a value is a class decorated with @App. */
function isDecoratedAppClass(value: unknown): value is AppType {
  return typeof value === 'function' && getMetadata(FrontMcpLocalAppTokens.type, value) === true;
}

/**
 * Check if an object has any manifest primitive arrays.
 */
function hasManifestPrimitives(obj: Record<string, unknown>): boolean {
  return MANIFEST_PRIMITIVE_KEYS.some((key) => Array.isArray(obj[key]));
}

/** The manifest of an @App class: its entries, under its name. */
function manifestOfApp(cls: AppType): FrontMcpPackageManifest {
  const metadata = collectAppMetadata(cls) as unknown as Record<string, unknown>;
  return { ...collectNamedExports(metadata), version: '0.0.0' };
}

/** The manifest of a @FrontMcp server: its own entries and those of its @App classes, under its `info`. */
function manifestOfServer(config: object): FrontMcpPackageManifest {
  const server = config as Record<string, unknown>;
  const info = (server['info'] ?? {}) as Record<string, unknown>;
  const apps = Array.isArray(server['apps']) ? server['apps'].filter(isDecoratedAppClass).map(manifestOfApp) : [];
  const parts = [collectNamedExports(server), ...apps];
  const entriesOf = (key: ManifestPrimitiveKey): unknown[] | undefined => {
    const entries = parts.flatMap((part) => part[key] ?? []);
    return entries.length > 0 ? entries : undefined;
  };
  return {
    name: typeof info['name'] === 'string' ? info['name'] : 'unknown',
    version: typeof info['version'] === 'string' ? info['version'] : '0.0.0',
    ...Object.fromEntries(MANIFEST_PRIMITIVE_KEYS.map((key) => [key, entriesOf(key)])),
  };
}

/**
 * Collect named exports into a manifest.
 */
function collectNamedExports(mod: Record<string, unknown>): FrontMcpPackageManifest {
  return {
    name: typeof mod['name'] === 'string' ? mod['name'] : 'unknown',
    version: typeof mod['version'] === 'string' ? mod['version'] : '0.0.0',
    description: typeof mod['description'] === 'string' ? mod['description'] : undefined,
    tools: Array.isArray(mod['tools']) ? (mod['tools'] as unknown[]) : undefined,
    prompts: Array.isArray(mod['prompts']) ? (mod['prompts'] as unknown[]) : undefined,
    resources: Array.isArray(mod['resources']) ? (mod['resources'] as unknown[]) : undefined,
    skills: Array.isArray(mod['skills']) ? (mod['skills'] as unknown[]) : undefined,
    agents: Array.isArray(mod['agents']) ? (mod['agents'] as unknown[]) : undefined,
    jobs: Array.isArray(mod['jobs']) ? (mod['jobs'] as unknown[]) : undefined,
    workflows: Array.isArray(mod['workflows']) ? (mod['workflows'] as unknown[]) : undefined,
    providers: Array.isArray(mod['providers']) ? (mod['providers'] as unknown[]) : undefined,
  };
}

/**
 * Check if a value is a decorated primitive class (@Tool, @Resource, @Prompt, @Skill, @Job, @Agent, @Workflow).
 */
function isDecoratedPrimitive(value: unknown): boolean {
  return (
    isDecoratedToolClass(value) ||
    isDecoratedResourceClass(value) ||
    isDecoratedPromptClass(value) ||
    isDecoratedSkillClass(value) ||
    isDecoratedJobClass(value) ||
    isDecoratedAgentClass(value) ||
    isDecoratedWorkflowClass(value)
  );
}

/**
 * Check if a module has any exports that are decorated primitive classes.
 */
function hasDecoratedClassExports(obj: Record<string, unknown>): boolean {
  return Object.values(obj).some((value) => value && typeof value === 'function' && isDecoratedPrimitive(value));
}

/**
 * Collect individually exported decorated classes into a manifest.
 * Scans all exports (including `default`) and groups them by decorator type; `@Provider` classes are the
 * package's providers.
 */
function collectDecoratedExports(mod: Record<string, unknown>): FrontMcpPackageManifest {
  const tools: unknown[] = [];
  const resources: unknown[] = [];
  const prompts: unknown[] = [];
  const skills: unknown[] = [];
  const jobs: unknown[] = [];
  const agents: unknown[] = [];
  const workflows: unknown[] = [];
  const providers: unknown[] = [];

  for (const value of Object.values(mod)) {
    if (!value || typeof value !== 'function') continue;
    if (isDecoratedToolClass(value)) tools.push(value);
    else if (isDecoratedResourceClass(value)) resources.push(value);
    else if (isDecoratedPromptClass(value)) prompts.push(value);
    else if (isDecoratedSkillClass(value)) skills.push(value);
    else if (isDecoratedJobClass(value)) jobs.push(value);
    else if (isDecoratedAgentClass(value)) agents.push(value);
    else if (isDecoratedWorkflowClass(value)) workflows.push(value);
    else if (isDecoratedProviderClass(value)) providers.push(value);
  }

  return {
    name: typeof mod['name'] === 'string' ? mod['name'] : 'unknown',
    version: typeof mod['version'] === 'string' ? mod['version'] : '0.0.0',
    ...(tools.length ? { tools } : {}),
    ...(resources.length ? { resources } : {}),
    ...(prompts.length ? { prompts } : {}),
    ...(skills.length ? { skills } : {}),
    ...(jobs.length ? { jobs } : {}),
    ...(agents.length ? { agents } : {}),
    ...(workflows.length ? { workflows } : {}),
    ...(providers.length ? { providers } : {}),
  };
}

/**
 * Validate a manifest object against the Zod schema.
 */
function validateManifest(obj: Record<string, unknown>): FrontMcpPackageManifest {
  const result = frontMcpPackageManifestSchema.safeParse(obj);
  if (!result.success) {
    throw new Error(`Invalid FrontMcpPackageManifest: ${result.error.message}`);
  }
  return result.data as FrontMcpPackageManifest;
}
